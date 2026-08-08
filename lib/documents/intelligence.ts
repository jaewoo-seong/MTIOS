import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  documentBlocks,
  documentConversions,
  documentImages,
  documentPages,
  documentRevisions,
  documentTables,
  storageObjects
} from "@/lib/db/schema";
import {
  convertToMarkdown,
  detectKind,
  titleFromFilename,
  type ConversionResult
} from "@/lib/documents/convert";
import {
  MTI_OPERATOR_ID,
  MTI_ORGANIZATION_ID,
  repository
} from "@/lib/repository";
import {
  getBinaryObject,
  getSignedObjectUrl,
  storage,
  storeBinaryObject
} from "@/lib/storage";

export type LayoutBox = { x: number; y: number; width: number; height: number };
export type IntelligenceBlock = {
  type: "heading" | "paragraph" | "list" | "table" | "image" | "unknown";
  position: number;
  text: string;
  bbox: LayoutBox | null;
  confidence: number;
  extractionMethod: "digital" | "ocr" | "ai_repair";
  aiRepaired?: boolean;
};
export type IntelligenceTable = {
  position: number;
  cells: string[][];
  bbox: LayoutBox | null;
  confidence: number;
  markdown: string;
};
export type IntelligenceImage = {
  position: number;
  bbox: LayoutBox | null;
  storageKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string;
  confidence: number;
};
export type IntelligencePage = {
  pageNumber: number;
  width: number | null;
  height: number | null;
  text: string;
  confidence: number;
  imageStorageKey: string | null;
  blocks: IntelligenceBlock[];
  tables: IntelligenceTable[];
  images: IntelligenceImage[];
};
export type IntelligenceResult = ConversionResult & {
  engine: string;
  engineVersion: string;
  language: string | null;
  ocrUsed: boolean;
  confidence: number;
  warnings: string[];
  needsReview: boolean;
  pages: IntelligencePage[];
};

type MemoryDocumentState = {
  conversions: Array<Record<string, unknown>>;
  pages: Array<Record<string, unknown>>;
  blocks: Array<Record<string, unknown>>;
  tables: Array<Record<string, unknown>>;
  images: Array<Record<string, unknown>>;
  revisions: Array<Record<string, unknown>>;
};
const globalDocuments = globalThis as typeof globalThis & {
  __mtiDocumentIntelligence?: MemoryDocumentState;
};
const memory = globalDocuments.__mtiDocumentIntelligence ??= {
  conversions: [], pages: [], blocks: [], tables: [], images: [], revisions: []
};

export async function ingestDocument(input: {
  folderId: string;
  projectId: string | null;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  preferredLanguages?: string[];
  converter?: typeof convertDocumentIntelligence;
  storeOriginal?: typeof storeBinaryObject;
}) {
  const sourceHash = sha256(input.buffer);
  const safeFilename = input.filename.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 180);
  const storageKey = `documents/originals/${sourceHash}/${safeFilename || "source"}`;
  const storageWarnings: string[] = [];
  let persistedStorageKey: string | null = null;
  const originalStore = input.storeOriginal ?? (storage ? storeBinaryObject : null);
  if (originalStore) {
    await originalStore(storageKey, input.mimeType || "application/octet-stream", input.buffer);
    persistedStorageKey = storageKey;
    if (db) {
      await db.insert(storageObjects).values({
        organizationId: MTI_ORGANIZATION_ID,
        key: storageKey,
        contentType: input.mimeType || "application/octet-stream",
        size: input.buffer.byteLength
      }).onConflictDoNothing();
    }
  } else {
    storageWarnings.push("Original storage unavailable in this environment.");
  }

  const kind = detectKind(input.filename, input.mimeType);
  const document = await repository.createDocument({
    aiGenerated: false,
    folderId: input.folderId,
    projectId: input.projectId,
    title: titleFromFilename(input.filename),
    filename: input.filename,
    mimeType: input.mimeType || "application/octet-stream",
    sourceKind: kind,
    sizeBytes: input.buffer.byteLength,
    pageCount: null,
    wordCount: 0,
    markdown: "",
    storageKey: persistedStorageKey
  });
  const conversionId = randomUUID();
  await createConversion(conversionId, document.id, sourceHash);
  try {
    const result = await (input.converter ?? convertDocumentIntelligence)({
      filename: input.filename,
      mimeType: input.mimeType,
      buffer: input.buffer,
      preferredLanguages: input.preferredLanguages ?? ["en", "ko"]
    });
    result.warnings.unshift(...storageWarnings);
    const updated = await repository.updateDocument(document.id, {
      title: result.title,
      markdown: result.markdown,
      pageCount: result.pageCount,
      wordCount: result.wordCount,
      sourceKind: result.kind
    });
    await completeConversion(conversionId, document.id, result);
    await recordDocumentRevision({
      documentId: document.id,
      markdown: result.markdown,
      source: "conversion",
      conversionId,
      approved: !result.needsReview
    });
    return {
      document: { ...document, ...updated, pageCount: result.pageCount, sourceKind: result.kind },
      conversion: publicConversion(conversionId, result, "completed"),
      originalStored: Boolean(persistedStorageKey)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document conversion failed.";
    await failConversion(conversionId, message, storageWarnings);
    return {
      document,
      conversion: {
        id: conversionId,
        status: "failed",
        confidence: 0,
        warnings: storageWarnings,
        error: message,
        needsReview: true
      },
      originalStored: Boolean(persistedStorageKey)
    };
  }
}

export async function convertDocumentIntelligence(input: {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  preferredLanguages: string[];
}): Promise<IntelligenceResult> {
  // Imports are intentionally local and deterministic: text, Markdown, and
  // preflighted simple DOCX never need the former OCR/PDF service.
  const basic = await convertToMarkdown(input.filename, input.mimeType, input.buffer);
  const pageBodies = splitPages(basic.markdown, basic.pageCount);
  const pages = pageBodies.map((text, index) => ({
    pageNumber: index + 1,
    width: null,
    height: null,
    text,
    confidence: text.includes("No extractable text") ? 0 : 85,
    imageStorageKey: null,
    blocks: markdownBlocks(text),
    tables: markdownTables(text),
    images: []
  }));
  return {
    ...basic,
    engine: "mti-local",
    engineVersion: "1",
    language: detectLanguage(basic.markdown),
    ocrUsed: false,
    confidence: pages.length
      ? Math.round(pages.reduce((total, page) => total + page.confidence, 0) / pages.length)
      : 0,
    warnings: ["Layout coordinates unavailable in local conversion mode."],
    needsReview: basic.truncated || pages.some((page) => page.confidence < 70),
    pages
  };
}

export async function recordDocumentRevision(input: {
  documentId: string;
  markdown: string;
  source: "conversion" | "manual" | "ai_repair" | "agent_rework" | "rollback";
  baseRevision?: number | null;
  changeSummary?: string;
  feedbackRequestId?: string | null;
  strategyVersionId?: string | null;
  conversionId?: string | null;
  approved?: boolean;
}) {
  const contentHash = sha256(Buffer.from(input.markdown));
  if (!db) {
    const previous = memory.revisions
      .filter((item) => item.documentId === input.documentId)
      .reduce((value, item) => Math.max(value, Number(item.revision)), 0);
    const revision = {
      id: randomUUID(),
      organizationId: MTI_ORGANIZATION_ID,
      documentId: input.documentId,
      revision: previous + 1,
      markdown: input.markdown,
      contentHash,
      source: input.source,
      baseRevision: input.baseRevision ?? null,
      changeSummary: input.changeSummary ?? "",
      feedbackRequestId: input.feedbackRequestId ?? null,
      strategyVersionId: input.strategyVersionId ?? null,
      conversionId: input.conversionId ?? null,
      createdBy: MTI_OPERATOR_ID,
      approved: input.approved ?? false,
      createdAt: new Date().toISOString()
    };
    memory.revisions.push(revision);
    return revision;
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.documentId}))`);
    const [{ value }] = await tx.select({ value: max(documentRevisions.revision) })
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, input.documentId));
    const [revision] = await tx.insert(documentRevisions).values({
      organizationId: MTI_ORGANIZATION_ID,
      documentId: input.documentId,
      revision: (value ?? 0) + 1,
      markdown: input.markdown,
      contentHash,
      source: input.source,
      baseRevision: input.baseRevision ?? null,
      changeSummary: input.changeSummary ?? "",
      feedbackRequestId: input.feedbackRequestId ?? null,
      strategyVersionId: input.strategyVersionId ?? null,
      conversionId: input.conversionId ?? null,
      createdBy: MTI_OPERATOR_ID,
      approved: input.approved ?? false
    }).returning();
    return revision;
  });
}

export async function getDocumentIntelligence(documentId: string) {
  const document = await repository.getDocument(documentId);
  if (!document) return null;
  if (!db) {
    const conversions = memory.conversions
      .filter((item) => item.documentId === documentId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const revisions = memory.revisions
      .filter((item) => item.documentId === documentId)
      .sort((a, b) => Number(b.revision) - Number(a.revision));
    return { document, conversions, revisions };
  }
  const [conversions, revisions] = await Promise.all([
    db.select().from(documentConversions).where(and(
      eq(documentConversions.documentId, documentId),
      eq(documentConversions.organizationId, MTI_ORGANIZATION_ID)
    )).orderBy(desc(documentConversions.createdAt)),
    db.select({
      id: documentRevisions.id,
      revision: documentRevisions.revision,
      markdown: documentRevisions.markdown,
      contentHash: documentRevisions.contentHash,
      source: documentRevisions.source,
      conversionId: documentRevisions.conversionId,
      approved: documentRevisions.approved,
      createdAt: documentRevisions.createdAt
    }).from(documentRevisions).where(and(
      eq(documentRevisions.documentId, documentId),
      eq(documentRevisions.organizationId, MTI_ORGANIZATION_ID)
    )).orderBy(desc(documentRevisions.revision))
  ]);
  return { document, conversions, revisions };
}

export async function getLatestApprovedDocumentRevision(documentId: string) {
  if (!db) {
    return memory.revisions
      .filter((item) => item.documentId === documentId && item.approved === true)
      .sort((a, b) => Number(b.revision) - Number(a.revision))[0] ?? null;
  }
  const [revision] = await db.select().from(documentRevisions).where(and(
    eq(documentRevisions.documentId, documentId),
    eq(documentRevisions.organizationId, MTI_ORGANIZATION_ID),
    eq(documentRevisions.approved, true)
  )).orderBy(desc(documentRevisions.revision)).limit(1);
  return revision ?? null;
}

export async function approveDocumentRevision(documentId: string, revisionId: string) {
  if (!db) {
    const revision = memory.revisions.find((item) =>
      item.id === revisionId && item.documentId === documentId
    );
    if (!revision) return null;
    if (revision.source === "agent_rework") {
      const latestApproved = memory.revisions
        .filter((item) => item.documentId === documentId && item.approved)
        .sort((left, right) => Number(right.revision) - Number(left.revision))[0];
      if (latestApproved && Number(latestApproved.revision) > Number(revision.baseRevision ?? 0)) {
        throw new Error("The document changed after this rework began. Compare the versions before accepting it.");
      }
    }
    revision.approved = true;
    if (revision.source === "ai_repair" || revision.source === "agent_rework" || revision.source === "rollback") {
      await repository.updateDocument(documentId, { markdown: String(revision.markdown) });
    }
    return revision;
  }
  const [candidate] = await db.select().from(documentRevisions).where(and(
      eq(documentRevisions.id, revisionId),
      eq(documentRevisions.documentId, documentId),
      eq(documentRevisions.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
  if (!candidate) return null;
  if (candidate.source === "agent_rework") {
    const [latestApproved] = await db.select().from(documentRevisions).where(and(
      eq(documentRevisions.documentId, documentId),
      eq(documentRevisions.organizationId, MTI_ORGANIZATION_ID),
      eq(documentRevisions.approved, true)
    )).orderBy(desc(documentRevisions.revision)).limit(1);
    if (latestApproved && latestApproved.revision > (candidate.baseRevision ?? 0)) {
      throw new Error("The document changed after this rework began. Compare the versions before accepting it.");
    }
  }
  const [revision] = await db.update(documentRevisions).set({ approved: true })
    .where(eq(documentRevisions.id, revisionId)).returning();
  if (revision && (revision.source === "ai_repair" || revision.source === "agent_rework" || revision.source === "rollback")) {
    await repository.updateDocument(documentId, { markdown: revision.markdown });
  }
  return revision ?? null;
}

export async function proposeAiDocumentRepair(documentId: string, fetcher: typeof fetch = fetch) {
  const detail = await getDocumentIntelligence(documentId);
  if (!detail) throw new Error("Document not found.");
  const conversion = detail.conversions[0];
  if (!conversion) throw new Error("Document conversion not found.");
  if (
    conversion.status !== "review_required" &&
    Number(conversion.confidence) >= 80 &&
    !(conversion.warnings as string[]).length
  ) {
    throw new Error("AI repair is limited to low-confidence document conversions.");
  }
  const baseUrl = process.env.LITELLM_BASE_URL;
  const apiKey = process.env.LITELLM_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("LiteLLM is not configured.");
  const response = await fetcher(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "worker_structured",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Repair only headings, reading order, and Markdown table structure.",
            "Do not add, remove, summarize, translate, or reinterpret factual content.",
            "Return JSON: {\"markdown\": string, \"changes\": string[]}."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            warnings: conversion.warnings,
            confidence: conversion.confidence,
            markdown: detail.document.markdown
          })
        }
      ]
    })
  });
  const payload = await response.json().catch(() => ({})) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message ?? "AI document repair failed.");
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI document repair returned no structured content.");
  const repaired = JSON.parse(content) as { markdown?: unknown; changes?: unknown };
  if (typeof repaired.markdown !== "string" || !Array.isArray(repaired.changes)) {
    throw new Error("AI document repair returned an invalid schema.");
  }
  const revision = await recordDocumentRevision({
    documentId,
    markdown: repaired.markdown,
    source: "ai_repair",
    conversionId: String(conversion.id),
    approved: false
  });
  return { revision, changes: repaired.changes, approvalRequired: true };
}

export async function retryDocumentConversion(documentId: string) {
  const document = await repository.getDocument(documentId);
  if (!document) throw new Error("Document not found.");
  if (!document.storageKey) throw new Error("Original file is unavailable for retry.");
  const buffer = await getBinaryObject(document.storageKey);
  const sourceHash = sha256(buffer);
  const conversionId = randomUUID();
  await createConversion(conversionId, document.id, sourceHash);
  try {
    const result = await convertDocumentIntelligence({
      filename: document.filename,
      mimeType: document.mimeType,
      buffer,
      preferredLanguages: ["en", "ko"]
    });
    await repository.updateDocument(document.id, {
      title: result.title,
      markdown: result.markdown,
      pageCount: result.pageCount,
      wordCount: result.wordCount,
      sourceKind: result.kind
    });
    await completeConversion(conversionId, document.id, result);
    await recordDocumentRevision({
      documentId,
      markdown: result.markdown,
      source: "conversion",
      conversionId,
      approved: !result.needsReview
    });
    return publicConversion(conversionId, result, "completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document conversion failed.";
    await failConversion(conversionId, message, []);
    throw new Error(message);
  }
}

export async function getOriginalDocumentUrl(documentId: string) {
  const document = await repository.getDocument(documentId);
  if (!document) return null;
  if (!document.storageKey) throw new Error("Original file is not available in object storage.");
  return getSignedObjectUrl(document.storageKey);
}

export async function exportEditableDocument(input: {
  title: string;
  markdown: string;
  format: "pdf" | "docx";
  fetcher?: typeof fetch;
}) {
  const endpoint = process.env.DOCUMENT_CONVERSION_SERVICE_URL;
  if (!endpoint) throw new Error("Private document conversion service is not configured.");
  const response = await (input.fetcher ?? fetch)(`${endpoint.replace(/\/$/, "")}/v1/export`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.DOCUMENT_CONVERSION_SERVICE_SECRET
        ? { authorization: `Bearer ${process.env.DOCUMENT_CONVERSION_SERVICE_SECRET}` }
        : {})
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(payload.detail ?? "Document export failed.");
  }
  return Buffer.from(await response.arrayBuffer());
}

async function createConversion(id: string, documentId: string, sourceHash: string) {
  const values = {
    id,
    organizationId: MTI_ORGANIZATION_ID,
    documentId,
    status: "executing",
    engine: process.env.DOCUMENT_CONVERSION_SERVICE_URL ? "mti-conversion-service" : "mti-local",
    engineVersion: "1",
    sourceHash,
    startedAt: new Date()
  };
  if (!db) memory.conversions.push({ ...values, createdAt: new Date().toISOString() });
  else await db.insert(documentConversions).values(values);
}

async function completeConversion(id: string, documentId: string, result: IntelligenceResult) {
  if (!db) {
    const conversion = memory.conversions.find((item) => item.id === id);
    if (conversion) Object.assign(conversion, {
      status: "completed",
      ...summary(result),
      completedAt: new Date().toISOString()
    });
    await persistMemoryLayout(id, result.pages);
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(documentConversions).set({
      status: result.needsReview ? "review_required" : "completed",
      engine: result.engine,
      engineVersion: result.engineVersion,
      language: result.language,
      ocrUsed: result.ocrUsed,
      confidence: result.confidence,
      warnings: result.warnings,
      completedAt: new Date(),
      updatedAt: new Date()
    }).where(and(
      eq(documentConversions.id, id),
      eq(documentConversions.organizationId, MTI_ORGANIZATION_ID)
    ));
    for (const page of result.pages) {
      const [pageRow] = await tx.insert(documentPages).values({
        conversionId: id,
        pageNumber: page.pageNumber,
        width: page.width,
        height: page.height,
        text: page.text,
        confidence: page.confidence,
        imageStorageKey: page.imageStorageKey
      }).returning();
      if (page.blocks.length) await tx.insert(documentBlocks).values(page.blocks.map((block) => ({
        pageId: pageRow.id,
        blockType: block.type,
        position: block.position,
        text: block.text,
        bbox: block.bbox,
        confidence: block.confidence,
        extractionMethod: block.extractionMethod,
        aiRepaired: block.aiRepaired ?? false
      })));
      if (page.tables.length) await tx.insert(documentTables).values(page.tables.map((table) => ({
        pageId: pageRow.id,
        position: table.position,
        cells: table.cells,
        bbox: table.bbox,
        confidence: table.confidence,
        markdown: table.markdown
      })));
      if (page.images.length) await tx.insert(documentImages).values(page.images.map((image) => ({
        pageId: pageRow.id,
        position: image.position,
        bbox: image.bbox,
        storageKey: image.storageKey,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        altText: image.altText,
        confidence: image.confidence
      })));
    }
  });
  void documentId;
}

async function failConversion(id: string, error: string, warnings: string[]) {
  if (!db) {
    const conversion = memory.conversions.find((item) => item.id === id);
    if (conversion) Object.assign(conversion, {
      status: "failed", error, warnings, completedAt: new Date().toISOString()
    });
    return;
  }
  await db.update(documentConversions).set({
    status: "failed",
    errorCode: "conversion_failed",
    error,
    warnings,
    completedAt: new Date(),
    updatedAt: new Date()
  }).where(and(
    eq(documentConversions.id, id),
    eq(documentConversions.organizationId, MTI_ORGANIZATION_ID)
  ));
}

async function persistMemoryLayout(conversionId: string, pages: IntelligencePage[]) {
  for (const page of pages) {
    const pageRow = { id: randomUUID(), conversionId, ...page };
    memory.pages.push(pageRow);
    memory.blocks.push(...page.blocks.map((block) => ({ id: randomUUID(), pageId: pageRow.id, ...block })));
    memory.tables.push(...page.tables.map((table) => ({ id: randomUUID(), pageId: pageRow.id, ...table })));
    memory.images.push(...page.images.map((image) => ({ id: randomUUID(), pageId: pageRow.id, ...image })));
  }
}

function splitPages(markdown: string, pageCount: number | null) {
  if (!pageCount) return [markdown];
  const parts = markdown.split(/^## Page \d+\s*$/gm).map((item) => item.trim()).filter(Boolean);
  return parts.length ? parts : [markdown];
}

function markdownBlocks(markdown: string): IntelligenceBlock[] {
  return markdown.split(/\n{2,}/).filter(Boolean).map((text, position) => ({
    type: /^#{1,6}\s/.test(text) ? "heading" as const
      : /^(?:[-*]\s|\d+[.)]\s)/.test(text) ? "list" as const
      : text.startsWith("|") ? "table" as const
      : "paragraph" as const,
    position,
    text,
    bbox: null,
    confidence: 85,
    extractionMethod: "digital" as const
  }));
}

function markdownTables(markdown: string): IntelligenceTable[] {
  const matches = markdown.match(/(?:^\|.*\|\s*$\n?)+/gm) ?? [];
  return matches.map((table, position) => ({
    position,
    cells: table.trim().split("\n")
      .filter((line) => !/^\|\s*(?:---+\s*\|)+$/.test(line))
      .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim())),
    bbox: null,
    confidence: 80,
    markdown: table.trim()
  }));
}

function detectLanguage(value: string) {
  const korean = (value.match(/[\uac00-\ud7af]/g) ?? []).length;
  const latin = (value.match(/[A-Za-z]/g) ?? []).length;
  if (korean && latin) return "multilingual";
  if (korean) return "ko";
  return latin ? "en" : null;
}

function summary(result: IntelligenceResult) {
  return {
    engine: result.engine,
    engineVersion: result.engineVersion,
    language: result.language,
    ocrUsed: result.ocrUsed,
    confidence: result.confidence,
    warnings: result.warnings
  };
}

function publicConversion(id: string, result: IntelligenceResult, status: string) {
  return { id, status: result.needsReview ? "review_required" : status, ...summary(result) };
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function getDocumentIntelligenceTestState() {
  return memory;
}
