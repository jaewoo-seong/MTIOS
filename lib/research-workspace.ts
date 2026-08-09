import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";
import { requestModel } from "@/lib/ai/litellm";
import { parseModelJson } from "@/lib/ai/model-json";
import { db, requireDatabase } from "@/lib/db/client";
import {
  clientDatabases,
  agendas,
  collectionCampaigns,
  collectionCandidates,
  dossierRevisionRequests,
  dossierContextSnapshots,
  documentRevisions,
  documents,
  projectResearchSettings,
  projectStrategyMessages,
  projectStrategyVersions,
  projects
} from "@/lib/db/schema";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";
import { isUiAuditMode } from "@/lib/ui-audit-mode";
import { defaultDossierEvidenceCapabilities, evidenceCapabilities } from "@/lib/research/evidence-capabilities";
import { buildDossierSummary, dossierSummarySourceLimit } from "@/lib/research/dossier-summary";
import {
  buildDossierTemplate,
  defaultDossierInformationExclusions,
  defaultDossierResearchPlan
} from "@/lib/research/dossier-blueprint";

const dossierResearchSectionShape = z.object({
  section: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(1).max(1000),
  evidenceNeeded: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  priority: z.enum(["required", "supporting"])
});

export const strategyShape = z.object({
  geographicScope: z.array(z.string().trim().min(1).max(200)).max(50),
  industries: z.array(z.string().trim().min(1).max(200)).max(50),
  targetProfile: z.string().trim().min(1).max(6000),
  exclusions: z.array(z.string().trim().min(1).max(500)).max(100),
  qualificationRules: z.array(z.string().trim().min(1).max(1000)).max(100),
  sourcePlan: z.array(z.string().trim().min(1).max(500)).max(100),
  evidenceCapabilities: z.array(z.enum(evidenceCapabilities)).min(1).max(evidenceCapabilities.length)
    .refine((capabilities) => capabilities.includes("legal_identity"), "legal_identity is required")
    .default(defaultDossierEvidenceCapabilities),
  queryFamilies: z.array(z.string().trim().min(1).max(1000)).max(200),
  // Derived from dossierResearchPlan below rather than authored. The plan is
  // what workers actually receive, so a separately supplied section list could
  // only ever disagree with the dossiers being produced.
  requiredDossierSections: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  dossierResearchPlan: z.array(dossierResearchSectionShape).min(4).max(16).default(defaultDossierResearchPlan),
  informationExclusions: z.array(z.string().trim().min(1).max(500)).max(30).default(defaultDossierInformationExclusions),
  evidenceStandard: z.string().trim().min(1).max(3000),
  newsFreshnessDays: z.number().int().min(1).max(3650),
  targetCompanyCount: z.number().int().min(1).max(100000).default(100),
  targetCompanyCountReason: z.string().trim().min(1).max(2000).default("Balanced initial research scope and operator review workload.")
}).transform((value) => ({
  ...value,
  requiredDossierSections: value.dossierResearchPlan.map((item) => item.section)
}));

const strategyProposalShape = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(4000),
  strategy: strategyShape,
  response: z.string().trim().min(1).max(12000)
});

export type ResearchStrategy = z.infer<typeof strategyShape>;

const defaultStrategy = (objective: string, scope: string): ResearchStrategy => ({
  geographicScope: scope ? [scope] : [],
  industries: [],
  targetProfile: objective,
  exclusions: [],
  qualificationRules: ["The company operates in the approved geography.", "There is credible evidence of a plausible MTI service opportunity."],
  sourcePlan: ["Official company sources", "Government and industry directories", "Recent reputable news", "Public professional and hiring sources"],
  evidenceCapabilities: defaultDossierEvidenceCapabilities,
  queryFamilies: [],
  requiredDossierSections: [
    ...defaultDossierResearchPlan.map((item) => item.section)
  ],
  dossierResearchPlan: defaultDossierResearchPlan,
  informationExclusions: defaultDossierInformationExclusions,
  evidenceStandard: "Every material factual claim requires an adjacent descriptive Markdown hyperlink and source date. Never display a bare full URL. Separate facts, inference, and sales hypotheses.",
  newsFreshnessDays: 365,
  targetCompanyCount: 100,
  targetCompanyCountReason: "A practical first campaign size that supports market coverage while keeping dossier review manageable."
});

type MemoryState = {
  settings: Array<Record<string, unknown>>;
  strategies: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  revisionRequests: Array<Record<string, unknown>>;
};
const memoryRoot = globalThis as typeof globalThis & { __researchWorkspace?: MemoryState };
const memory = memoryRoot.__researchWorkspace ??= { settings: [], strategies: [], messages: [], revisionRequests: [] };

function modelText(response: unknown) {
  const content = (response as { choices?: Array<{ message?: { content?: string | null } }> })
    ?.choices?.[0]?.message?.content;
  if (!content) throw new Error("The strategist returned no response.");
  return content;
}

export async function ensureResearchProject(projectId: string) {
  if (!db) {
    let settings = memory.settings.find((item) => item.projectId === projectId);
    if (!settings) {
      settings = {
        id: crypto.randomUUID(), projectId, activeStrategyVersionId: null,
        dossierWorkerLimit: 3, revisionWorkerLimit: 2, queueBufferTarget: 9, queueBufferAutomatic: true,
        discoveryCursor: 0, lastDiscoveryAt: null,
        discoveryEnabled: true, researchPaused: false, createdAt: new Date(), updatedAt: new Date()
      };
      memory.settings.push(settings);
    }
    return settings;
  }
  const database = requireDatabase();
  const [project] = await database.select({ name: projects.name }).from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, MTI_ORGANIZATION_ID))).limit(1);
  if (!project) throw new Error("Project not found.");
  const [settings] = await database.insert(projectResearchSettings).values({
    organizationId: MTI_ORGANIZATION_ID, projectId
  }).onConflictDoUpdate({
    target: projectResearchSettings.projectId,
    set: { updatedAt: new Date() }
  }).returning();
  await database.insert(clientDatabases).values({
    organizationId: MTI_ORGANIZATION_ID,
    projectId,
    name: `${project.name} companies`,
    description: `Companies researched for ${project.name}.`
  }).onConflictDoNothing({ target: clientDatabases.projectId });
  return settings;
}

export async function getResearchWorkspace(projectId: string) {
  const settings = await ensureResearchProject(projectId);
  if (!db) {
    if (isUiAuditMode()) return uiAuditResearchWorkspace(projectId, settings);
    return {
      settings,
      strategies: memory.strategies.filter((item) => item.projectId === projectId),
      messages: memory.messages.filter((item) => item.projectId === projectId),
      campaigns: [], candidates: [], documents: [], projectDocuments: [], revisionRequests: [], contextSnapshots: []
    };
  }
  const database = requireDatabase();
  const campaigns = await database.select().from(collectionCampaigns)
    .where(eq(collectionCampaigns.projectId, projectId)).orderBy(desc(collectionCampaigns.createdAt));
  const campaignIds = new Set(campaigns.map((item) => item.id));
  const [strategies, messages, allCandidates, projectDocuments, revisions, contextSnapshots] = await Promise.all([
    database.select().from(projectStrategyVersions).where(eq(projectStrategyVersions.projectId, projectId))
      .orderBy(desc(projectStrategyVersions.version)),
    database.select().from(projectStrategyMessages).where(eq(projectStrategyMessages.projectId, projectId))
      .orderBy(asc(projectStrategyMessages.createdAt)),
    database.select().from(collectionCandidates).orderBy(desc(collectionCandidates.priority), asc(collectionCandidates.createdAt)),
    database.select({
      id: documents.id, title: documents.title, filename: documents.filename, sourceKind: documents.sourceKind,
      wordCount: documents.wordCount, updatedAt: documents.updatedAt,
      // Bounded in SQL so neither the database read nor the polled response
      // carries whole master dossiers for a preview line.
      summarySource: sql<string>`left(${documents.markdown}, ${dossierSummarySourceLimit})`
    }).from(documents).where(and(eq(documents.projectId, projectId), eq(documents.organizationId, MTI_ORGANIZATION_ID)))
      .orderBy(desc(documents.updatedAt)),
    database.select().from(dossierRevisionRequests).where(eq(dossierRevisionRequests.projectId, projectId))
      .orderBy(desc(dossierRevisionRequests.createdAt)),
    database.select({
      id: dossierContextSnapshots.id,
      candidateId: dossierContextSnapshots.candidateId,
      strategyVersionId: dossierContextSnapshots.strategyVersionId,
      contentHash: dossierContextSnapshots.contentHash,
      createdAt: dossierContextSnapshots.createdAt
    }).from(dossierContextSnapshots).where(eq(dossierContextSnapshots.projectId, projectId))
      .orderBy(desc(dossierContextSnapshots.createdAt))
  ]);
  const summarized = projectDocuments.map(({ summarySource, ...document }) => ({
    ...document,
    summary: buildDossierSummary(summarySource ?? "")
  }));
  return {
    settings, strategies, messages, campaigns,
    candidates: allCandidates.filter((item) => campaignIds.has(item.campaignId)),
    documents: summarized.filter((document) => allCandidates.some(
      (candidate) => campaignIds.has(candidate.campaignId) && candidate.linkedDocumentId === document.id
    )),
    projectDocuments: summarized,
    revisionRequests: revisions,
    contextSnapshots
  };
}

function uiAuditResearchWorkspace(projectId: string, settings: Record<string, unknown>) {
  const campaignId = "60000000-0000-4000-8000-000000000001";
  const strategyId = "70000000-0000-4000-8000-000000000001";
  const dossierId = "30000000-0000-4000-8000-000000000001";
  const updatedAt = "2026-08-07T18:30:00.000Z";
  const activeSettings = { ...settings, activeStrategyVersionId: strategyId };
  const dossier = {
    id: dossierId, title: "Hanseong Precision Systems — Master Dossier",
    filename: "hanseong-precision-systems.md", sourceKind: "markdown",
    wordCount: 142, updatedAt,
    summary: buildDossierSummary("# Hanseong Precision Systems\n\n## Executive decision summary\nHanseong is a qualified precision-manufacturing prospect with current expansion and technical-hiring signals.\n\n## Why this company may need MTI services\nIts planned capacity expansion creates a supported need for market validation, workforce intelligence, and partner identification.\n\n## Path to becoming an MTI client\nApproach the strategy or business-development owner with a focused expansion-readiness diagnostic.")
  };
  return {
    settings: activeSettings,
    strategies: [{
      id: strategyId, projectId, version: 3, title: "Verified Korean manufacturing expansion signals",
      summary: "Prioritize manufacturers with recent investment, hiring, facility expansion, or export-market signals.",
      status: "active", createdAt: updatedAt,
      strategy: {
        geographicScope: ["Seoul Capital Area", "Chungcheong", "Busan", "Ulsan"],
        industries: ["Advanced manufacturing", "Industrial automation", "Robotics", "Supply-chain technology"],
        targetProfile: "Operating Korean companies with verifiable growth or transformation signals and a plausible need for MTI market, workforce, or commercial intelligence.",
        exclusions: ["Directories", "Dormant entities", "Companies without an identifiable operating presence"],
        qualificationRules: ["Evidence of Korean operations", "At least one recent commercial, workforce, or investment signal", "Plausible MTI service opportunity"],
        sourcePlan: ["Official company sources", "Government and industry records", "Recent reputable news", "Public hiring sources"],
        evidenceCapabilities: defaultDossierEvidenceCapabilities,
        queryFamilies: ["Korean factory expansion 2026", "Korea industrial automation hiring", "Busan manufacturing investment"],
        requiredDossierSections: ["Executive decision summary", "Company identity", "Current change and buying signals", "Decision-makers", "Why this company may need MTI services", "Path to becoming an MTI client", "Risks and evidence gaps", "Source index"],
        dossierResearchPlan: defaultDossierResearchPlan,
        informationExclusions: defaultDossierInformationExclusions,
        evidenceStandard: "Cite every material claim and label inference, unknowns, and conflicting evidence.",
        newsFreshnessDays: 365,
        targetCompanyCount: 100,
        targetCompanyCountReason: "Broad enough to compare regional manufacturing opportunities while retaining 25-company review checkpoints."
      }
    }],
    messages: [
      { id: "71000000-0000-4000-8000-000000000001", role: "user", content: "Prioritize expansion and workforce signals, and keep completed dossiers unchanged until I approve revisions.", strategyVersionId: null, createdAt: "2026-08-07T17:55:00.000Z" },
      { id: "71000000-0000-4000-8000-000000000002", role: "assistant", content: "Strategy v3 is active for the next discovery batch. Existing dossiers remain on their approved versions.", strategyVersionId: strategyId, createdAt: "2026-08-07T17:56:00.000Z" }
    ],
    campaigns: [{ id: campaignId, name: "Korean advanced manufacturing prospects", status: "active", targetCount: 100 }],
    candidates: [
      { id: "72000000-0000-4000-8000-000000000001", campaignId, data: { legalName: "Hanseong Precision Systems", website: "https://example.com/company", location: "Gyeonggi-do", industry: "Precision manufacturing" }, priority: 9, qualificationScore: 88, queueStatus: "completed", dossierStatus: "completed", dossierReason: "Qualified with expansion and hiring evidence.", disposition: "unreviewed", strategyVersionId: strategyId, linkedDocumentId: dossierId, updatedAt },
      { id: "72000000-0000-4000-8000-000000000002", campaignId, data: { legalName: "Busan Robotics & Logistics Innovation Consortium With A Deliberately Long Name", website: "", location: "Busan", industry: "Robotics" }, priority: 8, qualificationScore: 74, queueStatus: "queued", dossierStatus: "researching", dossierReason: null, disposition: "unreviewed", strategyVersionId: strategyId, linkedDocumentId: null, updatedAt },
      { id: "72000000-0000-4000-8000-000000000003", campaignId, data: { legalName: "충청 스마트팩토리 솔루션", website: "https://example.com/ko", location: "충청남도", industry: "스마트 제조" }, priority: 4, qualificationScore: 69, queueStatus: "queued", dossierStatus: "pending", dossierReason: null, disposition: "unreviewed", strategyVersionId: strategyId, linkedDocumentId: null, updatedAt },
      { id: "72000000-0000-4000-8000-000000000004", campaignId, data: { legalName: "Unverified Industrial Directory Entry", location: "Unknown" }, priority: 1, qualificationScore: 21, queueStatus: "held", dossierStatus: "failed", dossierReason: "Official operating identity could not be verified.", disposition: "declined", strategyVersionId: strategyId, linkedDocumentId: null, updatedAt }
    ],
    documents: [dossier], projectDocuments: [dossier],
    revisionRequests: [{ id: "73000000-0000-4000-8000-000000000001", documentId: dossierId, status: "queued", instruction: "Verify the latest hiring activity and expand the workforce section.", createdAt: updatedAt }],
    contextSnapshots: [{ id: "74000000-0000-4000-8000-000000000001", candidateId: "72000000-0000-4000-8000-000000000001", strategyVersionId: strategyId, contentHash: "ui-audit-context", createdAt: updatedAt }]
  };
}

export async function proposeResearchStrategy(input: {
  projectId: string;
  userId: string;
  instruction: string;
  attachmentDocumentIds?: string[];
}, model: typeof requestModel = requestModel) {
  const database = requireDatabase();
  const [project] = await database.select().from(projects).where(and(
    eq(projects.id, input.projectId), eq(projects.organizationId, MTI_ORGANIZATION_ID)
  )).limit(1);
  if (!project) throw new Error("Project not found.");
  await database.insert(projectStrategyMessages).values({
    organizationId: MTI_ORGANIZATION_ID, projectId: input.projectId, role: "user",
    content: input.instruction, attachmentDocumentIds: input.attachmentDocumentIds ?? [], createdBy: input.userId
  });
  const [active] = await database.select().from(projectStrategyVersions).where(and(
    eq(projectStrategyVersions.projectId, input.projectId), eq(projectStrategyVersions.status, "active")
  )).limit(1);
  const recent = await database.select({ role: projectStrategyMessages.role, content: projectStrategyMessages.content })
    .from(projectStrategyMessages).where(eq(projectStrategyMessages.projectId, input.projectId))
    .orderBy(desc(projectStrategyMessages.createdAt)).limit(20);
  const response = await model("executive_reasoning", [
    {
      role: "system",
      content: [
        "You are the premium research strategist for a continuous company-research project.",
        "Respond to the operator, and propose a complete next strategy. Preserve good parts of the active strategy unless asked to replace them.",
        "The strategy controls future discovery and queued dossiers; completed documents are never silently rewritten.",
        "For Korean markets, queryFamilies must include useful Korean-language and English-language searches.",
        'Return JSON only: {"title":"string","summary":"string","response":"string","strategy":{',
        '"geographicScope":["string"],"industries":["string"],"targetProfile":"string","exclusions":["string"],',
        '"qualificationRules":["string"],"sourcePlan":["string"],"evidenceCapabilities":["legal_identity","financial_filings","business_status","government_registration","official_website","recent_news","hiring","patents","market_context"],"queryFamilies":["string"],',
        '"dossierResearchPlan":[{"section":"string","purpose":"string","evidenceNeeded":["string"],"priority":"required|supporting"}],"informationExclusions":["string"],"evidenceStandard":"string","newsFreshnessDays":365,',
        '"targetCompanyCount":100,"targetCompanyCountReason":"explain why this target fits the market breadth, evidence availability, and review workload"}}',
        "Recommend a concrete targetCompanyCount; do not default mechanically to 100. Use the project scope and explain the recommendation.",
        "Choose only evidenceCapabilities that materially support this project. legal_identity is always required; market_context is project-level, while company capabilities are used per dossier.",
        "Design dossierResearchPlan as a synchronized, decision-focused document blueprint with 4-16 sections. Do not collect every available fact; collect only information that changes qualification, timing, service fit, outreach, risk, or approval.",
        "Always include required sections that answer (1) why the company may need specific MTI services and the evidence for that conclusion, and (2) how the company could become an MTI client, including buyer, trigger, entry point, first offer, and next action. Label sales hypotheses and confidence.",
        "Always prioritize a contact section for relevant buyers and sponsors. Require names, current titles, role relevance, public professional-profile hyperlinks, and publicly published business contact routes. Never infer an email pattern or include private personal data; explicitly mark unavailable fields.",
        "The evidence standard must require adjacent citations for every material claim. Require descriptive Markdown hyperlinks, never bare full URLs, throughout the dossier and source index.",
        "Use informationExclusions to name low-value information workers should deliberately skip."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        project: { objective: project.objective, context: project.context, scope: project.scope, constraints: project.constraints },
        activeStrategy: active?.strategy ?? defaultStrategy(project.objective, project.scope),
        conversation: recent.reverse(), instruction: input.instruction
      })
    }
  ], { structuredOutput: true });
  const proposal = strategyProposalShape.parse(parseModelJson(modelText(response)));
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`research-strategy:${input.projectId}`}))`);
    const [{ value }] = await tx.select({ value: max(projectStrategyVersions.version) })
      .from(projectStrategyVersions).where(eq(projectStrategyVersions.projectId, input.projectId));
    const [version] = await tx.insert(projectStrategyVersions).values({
      organizationId: MTI_ORGANIZATION_ID, projectId: input.projectId,
      version: (value ?? 0) + 1, title: proposal.title, summary: proposal.summary,
      strategy: proposal.strategy, basedOnVersionId: active?.id ?? null, proposedBy: input.userId
    }).returning();
    const [message] = await tx.insert(projectStrategyMessages).values({
      organizationId: MTI_ORGANIZATION_ID, projectId: input.projectId, role: "assistant",
      content: proposal.response, strategyVersionId: version.id
    }).returning();
    return { message, version };
  });
}

export async function activateResearchStrategy(projectId: string, strategyVersionId: string, userId: string) {
  const database = requireDatabase();
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`research-strategy:${projectId}`}))`);
    const [target] = await tx.select().from(projectStrategyVersions).where(and(
      eq(projectStrategyVersions.id, strategyVersionId), eq(projectStrategyVersions.projectId, projectId)
    )).limit(1);
    if (!target) return null;
    await tx.update(projectStrategyVersions).set({ status: "superseded", updatedAt: new Date() })
      .where(and(eq(projectStrategyVersions.projectId, projectId), eq(projectStrategyVersions.status, "active")));
    const [active] = await tx.update(projectStrategyVersions).set({
      status: "active", approvedBy: userId, approvedAt: new Date(), updatedAt: new Date()
    }).where(eq(projectStrategyVersions.id, strategyVersionId)).returning();
    await tx.insert(projectResearchSettings).values({
      organizationId: MTI_ORGANIZATION_ID, projectId, activeStrategyVersionId: strategyVersionId
    }).onConflictDoUpdate({
      target: projectResearchSettings.projectId,
      set: { activeStrategyVersionId: strategyVersionId, updatedAt: new Date() }
    });
    const campaigns = await tx.select({ id: collectionCampaigns.id }).from(collectionCampaigns)
      .where(eq(collectionCampaigns.projectId, projectId));
    // Strategies created before target recommendations were introduced remain
    // activatable. New proposals always carry an explicit, scope-aware target.
    const targetCompanyCount = target.strategy.targetCompanyCount ?? 100;
    if (campaigns.length === 0) {
      const [agenda] = await tx.insert(agendas).values({
        projectId, title: `Continuous company research — strategy v${target.version}`,
        instruction: target.summary || target.title, workType: "research", createdBy: userId
      }).returning();
      await tx.insert(collectionCampaigns).values({
        organizationId: MTI_ORGANIZATION_ID, projectId, agendaId: agenda.id,
        name: "Continuous client company research",
        entitySchema: [
          { name: "legalName", description: "Verified legal or primary operating name" },
          { name: "website", description: "Primary official website" },
          { name: "location", description: "Headquarters and relevant operating locations" },
          { name: "industry", description: "Primary industry and business classification" },
          { name: "qualificationReason", description: "Evidence-based reason this company fits the strategy" }
        ],
        documentTemplate: buildDossierTemplate(target.strategy),
        dedupeKeys: ["website", "legalName"],
        qualificationRules: target.strategy.qualificationRules,
        targetCount: targetCompanyCount,
        saturationRule: `Stop discovery after ${targetCompanyCount} unique qualified companies; pause temporarily whenever the queue buffer is full.`,
        status: "active"
      });
    } else {
      await tx.update(collectionCampaigns).set({
        qualificationRules: target.strategy.qualificationRules,
        targetCount: targetCompanyCount,
        saturationRule: `Stop discovery after ${targetCompanyCount} unique qualified companies; pause temporarily whenever the queue buffer is full.`,
        documentTemplate: buildDossierTemplate(target.strategy),
        status: "active", updatedAt: new Date()
      }).where(eq(collectionCampaigns.projectId, projectId));
    }
    // Existing queued companies stay pinned to the strategy that discovered
    // them. The new version governs future discovery; changing an already-
    // qualified company requires an explicit requalification action.
    return active;
  });
}

export async function updateResearchSettings(projectId: string, input: {
  dossierWorkerLimit?: number;
  revisionWorkerLimit?: number;
  queueBufferTarget?: number;
  queueBufferAutomatic?: boolean;
  discoveryEnabled?: boolean;
  researchPaused?: boolean;
}) {
  const database = requireDatabase();
  return database.transaction(async (tx) => {
    const [current] = await tx.select().from(projectResearchSettings)
      .where(eq(projectResearchSettings.projectId, projectId)).limit(1);
    const queue = deriveQueueBufferSettings(current, input);
    const values = { ...input, ...queue };
    const [settings] = await tx.insert(projectResearchSettings).values({
      organizationId: MTI_ORGANIZATION_ID, projectId, ...values
    }).onConflictDoUpdate({
      target: projectResearchSettings.projectId,
      set: { ...values, updatedAt: new Date() }
    }).returning();
    return settings;
  });
}

export function deriveQueueBufferSettings(
  current: { dossierWorkerLimit?: number; queueBufferTarget?: number; queueBufferAutomatic?: boolean } | null | undefined,
  input: { dossierWorkerLimit?: number; queueBufferTarget?: number; queueBufferAutomatic?: boolean }
) {
  const manualQueueChange = input.queueBufferTarget !== undefined && input.queueBufferAutomatic === undefined;
  const queueBufferAutomatic = manualQueueChange
    ? false
    : input.queueBufferAutomatic ?? current?.queueBufferAutomatic ?? true;
  const dossierWorkerLimit = input.dossierWorkerLimit ?? current?.dossierWorkerLimit ?? 3;
  const queueBufferTarget = queueBufferAutomatic
    ? Math.min(100, Math.max(1, dossierWorkerLimit * 3))
    : input.queueBufferTarget ?? current?.queueBufferTarget ?? 9;
  return { dossierWorkerLimit, queueBufferTarget, queueBufferAutomatic };
}

export async function updateCandidateControl(projectId: string, candidateId: string, input: {
  priority?: number;
  held?: boolean;
  disposition?: "unreviewed" | "approved" | "declined" | "needs_revision";
}) {
  const database = requireDatabase();
  const [candidate] = await database.select({ candidate: collectionCandidates, projectId: collectionCampaigns.projectId })
    .from(collectionCandidates).innerJoin(collectionCampaigns, eq(collectionCampaigns.id, collectionCandidates.campaignId))
    .where(eq(collectionCandidates.id, candidateId)).limit(1);
  if (!candidate || candidate.projectId !== projectId) return null;
  const values = {
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.held !== undefined ? {
      queueStatus: input.held ? "held" : "queued",
      heldAt: input.held ? new Date() : null
    } : {}),
    ...(input.disposition !== undefined ? { disposition: input.disposition } : {}),
    updatedAt: new Date()
  };
  const [updated] = await database.update(collectionCandidates).set(values)
    .where(eq(collectionCandidates.id, candidateId)).returning();
  return updated;
}

export async function createDossierRevisionRequest(input: {
  projectId: string;
  documentId: string;
  userId: string;
  instruction: string;
  questions?: string[];
  attachmentDocumentIds?: string[];
}) {
  const database = requireDatabase();
  const [document] = await database.select().from(documents).where(and(
    eq(documents.id, input.documentId), eq(documents.projectId, input.projectId),
    eq(documents.aiGenerated, true)
  )).limit(1);
  if (!document) return null;
  const [{ revision }] = await database.select({ revision: max(documentRevisions.revision) })
    .from(documentRevisions).where(eq(documentRevisions.documentId, input.documentId));
  const [request] = await database.insert(dossierRevisionRequests).values({
    organizationId: MTI_ORGANIZATION_ID, projectId: input.projectId, documentId: input.documentId,
    baseRevision: revision ?? 0, instruction: input.instruction, questions: input.questions ?? [],
    attachmentDocumentIds: input.attachmentDocumentIds ?? [], createdBy: input.userId
  }).returning();
  return request;
}

export async function getProjectClientDatabase(projectId: string) {
  if (!db) return null;
  const [database] = await db.select().from(clientDatabases).where(eq(clientDatabases.projectId, projectId)).limit(1);
  return database ?? null;
}
