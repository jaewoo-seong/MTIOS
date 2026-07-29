import { createHash } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type {
  ContextAuthority,
  ContextChunk,
  ContextCitation,
  ContextLanguage,
  ContextPack,
  ContextSource
} from "@/lib/domain";
import { db } from "@/lib/db/client";
import {
  contextChunks,
  contextPackItems,
  contextPacks,
  contextSources
} from "@/lib/db/schema";
import { MTI_ORGANIZATION_ID, repository } from "@/lib/repository";
import { listApprovedCreativeContext } from "@/lib/creative-work";

const DEFAULT_TOKEN_BUDGET = 8000;
const EMBEDDING_ROUTE = process.env.LITELLM_EMBEDDING_ROUTE ?? "multilingual_embedding";
const MAX_SOURCE_CHARS = 200_000;

type SourceInput = {
  projectId: string | null;
  agendaId: string | null;
  sourceType: ContextSource["sourceType"];
  sourceId: string;
  title: string;
  content: string;
  authority: ContextAuthority;
  approvalStatus: ContextSource["approvalStatus"];
  expiresAt?: string | null;
};

type PackInput = {
  query: string;
  projectId?: string | null;
  agendaId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  commandId?: string | null;
  tokenBudget?: number;
};

type MemoryContextStore = {
  sources: ContextSource[];
  chunks: ContextChunk[];
  packs: ContextPack[];
};

const globalContext = globalThis as typeof globalThis & {
  __businessOsContextStore?: MemoryContextStore;
};
const memory = globalContext.__businessOsContextStore ??= {
  sources: [],
  chunks: [],
  packs: []
};

export async function buildContextPack(input: PackInput): Promise<ContextPack> {
  const query = input.query.trim();
  const tokenBudget = clamp(input.tokenBudget ?? DEFAULT_TOKEN_BUDGET, 500, 32_000);
  await syncContextSources(input.projectId ?? null);

  const queryLanguage = detectLanguage(query);
  const candidates = await listCandidateChunks(input.projectId ?? null);
  const scored = candidates
    .map(({ source, chunk }) => ({
      source,
      chunk,
      score: scoreChunk(query, queryLanguage, source, chunk, input)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.contentHash.localeCompare(b.chunk.contentHash));

  const selected: typeof scored = [];
  const seen = new Set<string>();
  let tokenCount = 0;
  for (const candidate of scored) {
    if (seen.has(candidate.chunk.contentHash)) continue;
    if (tokenCount + candidate.chunk.tokenEstimate > tokenBudget && selected.length > 0) continue;
    selected.push(candidate);
    seen.add(candidate.chunk.contentHash);
    tokenCount += candidate.chunk.tokenEstimate;
    if (tokenCount >= tokenBudget) break;
  }

  const contentHash = hash([
    query,
    input.projectId ?? "",
    input.agendaId ?? "",
    input.taskId ?? "",
    ...selected.map((item) => item.chunk.contentHash)
  ].join("|"));
  return persistPack(input, queryLanguage, tokenBudget, tokenCount, contentHash, selected);
}

export async function getContextPack(id: string): Promise<ContextPack | undefined> {
  if (!db) return memory.packs.find((pack) => pack.id === id);
  const [pack] = await db.select().from(contextPacks)
    .where(and(
      eq(contextPacks.id, id),
      eq(contextPacks.organizationId, MTI_ORGANIZATION_ID)
    ))
    .limit(1);
  if (!pack) return undefined;
  const rows = await db.select({
    item: contextPackItems,
    chunk: contextChunks,
    source: contextSources
  }).from(contextPackItems)
    .innerJoin(contextChunks, eq(contextPackItems.chunkId, contextChunks.id))
    .innerJoin(contextSources, eq(contextChunks.sourceId, contextSources.id))
    .where(eq(contextPackItems.packId, id))
    .orderBy(asc(contextPackItems.rank));
  return packRow(pack, rows.map(({ item, chunk, source }) =>
    citationRow(item, chunk, source)
  ));
}

export function detectLanguage(value: string): ContextLanguage {
  const korean = (value.match(/[\uac00-\ud7af]/g) ?? []).length;
  const latin = (value.match(/[A-Za-z]/g) ?? []).length;
  if (korean === 0 && latin === 0) return "unknown";
  if (korean > 0 && latin > 0 && Math.min(korean, latin) / Math.max(korean, latin) > 0.15) {
    return "mixed";
  }
  return korean > latin ? "ko" : "en";
}

export function chunkContent(content: string, maxChars = 1200, overlap = 160) {
  const clean = content.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < clean.length) {
    let end = Math.min(clean.length, cursor + maxChars);
    if (end < clean.length) {
      const boundary = Math.max(
        clean.lastIndexOf("\n\n", end),
        clean.lastIndexOf(". ", end),
        clean.lastIndexOf("다. ", end)
      );
      if (boundary > cursor + maxChars * 0.55) end = boundary + 1;
    }
    const chunk = clean.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
    cursor = Math.max(cursor + 1, end - overlap);
  }
  return chunks;
}

async function syncContextSources(projectId: string | null) {
  const inputs: SourceInput[] = [];
  const approvedKnowledge = (await repository.listKnowledge())
    .filter((entry) => entry.status === "approved");
  for (const entry of approvedKnowledge) {
    inputs.push({
      projectId: null,
      agendaId: null,
      sourceType: "knowledge",
      sourceId: entry.id,
      title: entry.title,
      content: entry.content,
      authority: "approved",
      approvalStatus: "approved"
    });
  }

  if (projectId) {
    const project = await repository.getProject(projectId);
    if (!project) throw new Error("Project not found for context retrieval.");
    inputs.push({
      projectId,
      agendaId: null,
      sourceType: "project",
      sourceId: project.id,
      title: project.name,
      content: [
        project.objective, project.context, project.scope,
        ...project.constraints, ...project.reviewGates, ...project.outputRequirements
      ].filter(Boolean).join("\n\n"),
      authority: "authoritative",
      approvalStatus: "approved"
    });

    const [agendas, reports, documents] = await Promise.all([
      repository.listAgendas(projectId),
      repository.listReports(),
      repository.listDocuments()
    ]);
    const creative = await listApprovedCreativeContext(projectId);
    for (const brand of creative.brands) {
      inputs.push({
        projectId: typeof brand.projectId === "string" ? brand.projectId : null,
        agendaId: null,
        sourceType: "brand_profile",
        sourceId: brand.id,
        title: String(brand.name),
        content: JSON.stringify({
          audience: brand.audience,
          positioning: brand.positioning,
          voice: brand.voice,
          approvedClaims: brand.approvedClaims,
          prohibitedClaims: brand.prohibitedClaims,
          competitors: brand.competitors
        }),
        authority: "approved",
        approvalStatus: "approved"
      });
    }
    for (const campaign of creative.campaigns) {
      inputs.push({
        projectId,
        agendaId: typeof campaign.agendaId === "string" ? campaign.agendaId : null,
        sourceType: "marketing_campaign",
        sourceId: campaign.id,
        title: String(campaign.name),
        content: JSON.stringify({
          objective: campaign.objective,
          audiences: campaign.audiences,
          positioning: campaign.positioning,
          channels: campaign.channels,
          formats: campaign.formats,
          assumptions: campaign.assumptions,
          successMetrics: campaign.successMetrics
        }),
        authority: "approved",
        approvalStatus: "approved"
      });
    }
    for (const agenda of agendas) {
      inputs.push({
        projectId,
        agendaId: agenda.id,
        sourceType: "agenda",
        sourceId: agenda.id,
        title: agenda.title,
        content: agenda.instruction,
        authority: "working",
        approvalStatus: "working"
      });
    }
    for (const report of reports.filter((item) => item.projectId === projectId)) {
      inputs.push({
        projectId,
        agendaId: null,
        sourceType: "report",
        sourceId: report.id,
        title: report.title,
        content: `${report.summary}\n\n${report.content}`,
        authority: report.status === "saved" ? "approved" : "working",
        approvalStatus: report.status === "saved" ? "approved" : "working"
      });
    }
    for (const document of documents.filter((item) => item.projectId === projectId).slice(0, 100)) {
      const detail = await repository.getDocument(document.id);
      if (!detail) continue;
      inputs.push({
        projectId,
        agendaId: null,
        sourceType: "document",
        sourceId: document.id,
        title: document.title,
        content: detail.markdown,
        authority: "working",
        approvalStatus: "working"
      });
    }
  }
  await Promise.all(inputs.map(upsertSource));
}

async function upsertSource(input: SourceInput) {
  const content = input.content.slice(0, MAX_SOURCE_CHARS);
  const contentHash = hash(content);
  const language = detectLanguage(content);
  const pieces = chunkContent(content);
  if (!db) {
    let source = memory.sources.find((item) =>
      item.sourceType === input.sourceType && item.sourceId === input.sourceId
    );
    if (!source) {
      source = {
        id: crypto.randomUUID(),
        organizationId: MTI_ORGANIZATION_ID,
        ...input,
        expiresAt: input.expiresAt ?? null,
        language,
        contentHash,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      memory.sources.push(source);
    } else if (source.contentHash === contentHash) {
      return;
    } else {
      Object.assign(source, input, { language, contentHash, updatedAt: new Date().toISOString() });
      memory.chunks = memory.chunks.filter((chunk) => chunk.sourceId !== source?.id);
    }
    memory.chunks.push(...pieces.map((piece, ordinal) => ({
      id: crypto.randomUUID(),
      sourceId: source.id,
      ordinal,
      content: piece,
      contentHash: hash(piece),
      language: detectLanguage(piece),
      tokenEstimate: estimateTokens(piece),
      embeddingRoute: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })));
    return;
  }

  const [existing] = await db.select().from(contextSources)
    .where(and(
      eq(contextSources.organizationId, MTI_ORGANIZATION_ID),
      eq(contextSources.sourceType, input.sourceType),
      eq(contextSources.sourceId, input.sourceId)
    ))
    .limit(1);
  if (existing?.contentHash === contentHash) return;

  await db.transaction(async (tx) => {
    const [source] = await tx.insert(contextSources).values({
      organizationId: MTI_ORGANIZATION_ID,
      ...input,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      language,
      contentHash
    }).onConflictDoUpdate({
      target: [contextSources.organizationId, contextSources.sourceType, contextSources.sourceId],
      set: {
        projectId: input.projectId,
        agendaId: input.agendaId,
        title: input.title,
        language,
        authority: input.authority,
        approvalStatus: input.approvalStatus,
        contentHash,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        updatedAt: new Date()
      }
    }).returning();
    await tx.delete(contextChunks).where(eq(contextChunks.sourceId, source.id));
    if (pieces.length > 0) {
      await tx.insert(contextChunks).values(pieces.map((piece, ordinal) => ({
        sourceId: source.id,
        ordinal,
        content: piece,
        contentHash: hash(piece),
        language: detectLanguage(piece),
        tokenEstimate: estimateTokens(piece)
      })));
    }
  });
}

async function listCandidateChunks(projectId: string | null) {
  if (!db) {
    return memory.chunks.flatMap((chunk) => {
      const source = memory.sources.find((item) => item.id === chunk.sourceId);
      if (!source || source.approvalStatus === "proposed" || source.approvalStatus === "rejected") return [];
      if (source.expiresAt && source.expiresAt <= new Date().toISOString()) return [];
      if (source.projectId && source.projectId !== projectId) return [];
      return [{ source, chunk }];
    });
  }
  const scope = projectId
    ? or(isNull(contextSources.projectId), eq(contextSources.projectId, projectId))
    : isNull(contextSources.projectId);
  const rows = await db.select({ source: contextSources, chunk: contextChunks })
    .from(contextChunks)
    .innerJoin(contextSources, eq(contextChunks.sourceId, contextSources.id))
    .where(and(
      eq(contextSources.organizationId, MTI_ORGANIZATION_ID),
      inArray(contextSources.approvalStatus, ["approved", "working"]),
      or(isNull(contextSources.expiresAt), gt(contextSources.expiresAt, new Date())),
      scope
    ))
    .limit(2000);
  return rows.map(({ source, chunk }) => ({
    source: sourceRow(source),
    chunk: chunkRow(chunk)
  }));
}

async function persistPack(
  input: PackInput,
  queryLanguage: ContextLanguage,
  tokenBudget: number,
  tokenCount: number,
  contentHash: string,
  selected: Array<{ source: ContextSource; chunk: ContextChunk; score: number }>
) {
  if (!db) {
    const packId = crypto.randomUUID();
    const pack: ContextPack = {
      id: packId,
      organizationId: MTI_ORGANIZATION_ID,
      projectId: input.projectId ?? null,
      agendaId: input.agendaId ?? null,
      taskId: input.taskId ?? null,
      runId: input.runId ?? null,
      commandId: input.commandId ?? null,
      query: input.query.trim(),
      queryLanguage,
      tokenBudget,
      tokenCount,
      embeddingRoute: EMBEDDING_ROUTE,
      contentHash,
      citations: selected.map((item, index) => citation(item, crypto.randomUUID(), index + 1)),
      createdAt: new Date().toISOString()
    };
    memory.packs.push(pack);
    return pack;
  }
  return db.transaction(async (tx) => {
    const [pack] = await tx.insert(contextPacks).values({
      organizationId: MTI_ORGANIZATION_ID,
      projectId: input.projectId ?? null,
      agendaId: input.agendaId ?? null,
      taskId: input.taskId ?? null,
      runId: input.runId ?? null,
      commandId: input.commandId ?? null,
      query: input.query.trim(),
      queryLanguage,
      tokenBudget,
      tokenCount,
      embeddingRoute: EMBEDDING_ROUTE,
      contentHash
    }).returning();
    const inserted = selected.length === 0 ? [] : await tx.insert(contextPackItems).values(
      selected.map((item, index) => ({
        packId: pack.id,
        chunkId: item.chunk.id,
        rank: index + 1,
        scoreMicros: Math.round(item.score * 1_000_000),
        citation: formatCitation(item.source, item.chunk),
        tokenCount: item.chunk.tokenEstimate
      }))
    ).returning();
    return packRow(pack, selected.map((item, index) =>
      citation(item, inserted[index].id, index + 1)
    ));
  });
}

function scoreChunk(
  query: string,
  queryLanguage: ContextLanguage,
  source: ContextSource,
  chunk: ContextChunk,
  input: PackInput
) {
  const terms = tokenize(query);
  const haystack = chunk.content.toLocaleLowerCase();
  const matched = terms.filter((term) => haystack.includes(term)).length;
  const lexical = terms.length === 0 ? 0.1 : matched / terms.length;
  const scope = source.projectId && source.projectId === input.projectId ? 0.25 : 0.08;
  const agenda = source.agendaId && source.agendaId === input.agendaId ? 0.2 : 0;
  const language = queryLanguage === "unknown" || chunk.language === queryLanguage || chunk.language === "mixed" ? 0.1 : 0;
  const authority = source.authority === "authoritative" ? 0.2 : source.authority === "approved" ? 0.15 : 0.05;
  return lexical + scope + agenda + language + authority;
}

function citation(
  item: { source: ContextSource; chunk: ContextChunk; score: number },
  packItemId: string,
  rank: number
): ContextCitation {
  return {
    packItemId,
    chunkId: item.chunk.id,
    sourceType: item.source.sourceType,
    sourceId: item.source.sourceId,
    title: item.source.title,
    language: item.chunk.language,
    content: item.chunk.content,
    score: item.score,
    citation: `[${rank}] ${formatCitation(item.source, item.chunk)}`,
    tokenCount: item.chunk.tokenEstimate
  };
}

function citationRow(
  item: typeof contextPackItems.$inferSelect,
  chunk: typeof contextChunks.$inferSelect,
  source: typeof contextSources.$inferSelect
): ContextCitation {
  return {
    packItemId: item.id,
    chunkId: chunk.id,
    sourceType: source.sourceType as ContextSource["sourceType"],
    sourceId: source.sourceId,
    title: source.title,
    language: chunk.language as ContextLanguage,
    content: chunk.content,
    score: item.scoreMicros / 1_000_000,
    citation: item.citation,
    tokenCount: item.tokenCount
  };
}

function packRow(
  row: typeof contextPacks.$inferSelect,
  citations: ContextCitation[]
): ContextPack {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    agendaId: row.agendaId,
    taskId: row.taskId,
    runId: row.runId,
    commandId: row.commandId,
    query: row.query,
    queryLanguage: row.queryLanguage as ContextLanguage,
    tokenBudget: row.tokenBudget,
    tokenCount: row.tokenCount,
    embeddingRoute: row.embeddingRoute,
    contentHash: row.contentHash,
    citations,
    createdAt: row.createdAt.toISOString()
  };
}

function sourceRow(row: typeof contextSources.$inferSelect): ContextSource {
  return {
    ...row,
    sourceType: row.sourceType as ContextSource["sourceType"],
    language: row.language as ContextLanguage,
    authority: row.authority as ContextAuthority,
    approvalStatus: row.approvalStatus as ContextSource["approvalStatus"],
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function chunkRow(row: typeof contextChunks.$inferSelect): ContextChunk {
  return {
    id: row.id,
    sourceId: row.sourceId,
    ordinal: row.ordinal,
    content: row.content,
    contentHash: row.contentHash,
    language: row.language as ContextLanguage,
    tokenEstimate: row.tokenEstimate,
    embeddingRoute: row.embeddingRoute,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function tokenize(value: string) {
  return [...new Set(
    value.toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((term) => term.trim())
      .filter((term) => term.length > 1)
  )].slice(0, 40);
}

function formatCitation(source: ContextSource, chunk: ContextChunk) {
  return `${source.title} (${source.sourceType}:${source.sourceId}, chunk ${chunk.ordinal + 1})`;
}

function estimateTokens(value: string) {
  const korean = (value.match(/[\uac00-\ud7af]/g) ?? []).length;
  const other = Math.max(0, value.length - korean);
  return Math.max(1, Math.ceil(korean / 1.6 + other / 4));
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
