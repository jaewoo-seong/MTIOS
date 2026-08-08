import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
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
  documentRevisions,
  documents,
  projectResearchSettings,
  projectStrategyMessages,
  projectStrategyVersions,
  projects
} from "@/lib/db/schema";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";

export const strategyShape = z.object({
  geographicScope: z.array(z.string().trim().min(1).max(200)).max(50),
  industries: z.array(z.string().trim().min(1).max(200)).max(50),
  targetProfile: z.string().trim().min(1).max(6000),
  exclusions: z.array(z.string().trim().min(1).max(500)).max(100),
  qualificationRules: z.array(z.string().trim().min(1).max(1000)).max(100),
  sourcePlan: z.array(z.string().trim().min(1).max(500)).max(100),
  queryFamilies: z.array(z.string().trim().min(1).max(1000)).max(200),
  requiredDossierSections: z.array(z.string().trim().min(1).max(300)).min(1).max(50),
  evidenceStandard: z.string().trim().min(1).max(3000),
  newsFreshnessDays: z.number().int().min(1).max(3650)
});

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
  queryFamilies: [],
  requiredDossierSections: [
    "Executive summary", "Company profile", "Products and markets", "Leadership and professional contacts",
    "Organization and HR intelligence", "Recent news", "Opportunity analysis", "Risks and evidence gaps", "Sources"
  ],
  evidenceStandard: "Material factual claims require a source URL and retrieval date. Separate facts, inference, and sales hypotheses.",
  newsFreshnessDays: 365
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
        dossierWorkerLimit: 3, revisionWorkerLimit: 2, queueBufferTarget: 8,
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
    return {
      settings,
      strategies: memory.strategies.filter((item) => item.projectId === projectId),
      messages: memory.messages.filter((item) => item.projectId === projectId),
      campaigns: [], candidates: [], documents: [], projectDocuments: [], revisionRequests: []
    };
  }
  const database = requireDatabase();
  const campaigns = await database.select().from(collectionCampaigns)
    .where(eq(collectionCampaigns.projectId, projectId)).orderBy(desc(collectionCampaigns.createdAt));
  const campaignIds = new Set(campaigns.map((item) => item.id));
  const [strategies, messages, allCandidates, projectDocuments, revisions] = await Promise.all([
    database.select().from(projectStrategyVersions).where(eq(projectStrategyVersions.projectId, projectId))
      .orderBy(desc(projectStrategyVersions.version)),
    database.select().from(projectStrategyMessages).where(eq(projectStrategyMessages.projectId, projectId))
      .orderBy(asc(projectStrategyMessages.createdAt)),
    database.select().from(collectionCandidates).orderBy(desc(collectionCandidates.priority), asc(collectionCandidates.createdAt)),
    database.select({
      id: documents.id, title: documents.title, filename: documents.filename, sourceKind: documents.sourceKind,
      wordCount: documents.wordCount, updatedAt: documents.updatedAt
    }).from(documents).where(and(eq(documents.projectId, projectId), eq(documents.organizationId, MTI_ORGANIZATION_ID)))
      .orderBy(desc(documents.updatedAt)),
    database.select().from(dossierRevisionRequests).where(eq(dossierRevisionRequests.projectId, projectId))
      .orderBy(desc(dossierRevisionRequests.createdAt))
  ]);
  return {
    settings, strategies, messages, campaigns,
    candidates: allCandidates.filter((item) => campaignIds.has(item.campaignId)),
    documents: projectDocuments.filter((document) => allCandidates.some(
      (candidate) => campaignIds.has(candidate.campaignId) && candidate.linkedDocumentId === document.id
    )),
    projectDocuments,
    revisionRequests: revisions
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
        'Return JSON only: {"title":"string","summary":"string","response":"string","strategy":{',
        '"geographicScope":["string"],"industries":["string"],"targetProfile":"string","exclusions":["string"],',
        '"qualificationRules":["string"],"sourcePlan":["string"],"queryFamilies":["string"],',
        '"requiredDossierSections":["string"],"evidenceStandard":"string","newsFreshnessDays":365}}'
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
        documentTemplate: masterDossierTemplate,
        dedupeKeys: ["website", "legalName"],
        qualificationRules: target.strategy.qualificationRules,
        targetCount: null,
        saturationRule: "Continuous discovery pauses when the qualified queue buffer is full and resumes when capacity becomes available.",
        status: "active"
      });
    } else {
      await tx.update(collectionCampaigns).set({
        qualificationRules: target.strategy.qualificationRules,
        documentTemplate: masterDossierTemplate,
        status: "active", updatedAt: new Date()
      }).where(eq(collectionCampaigns.projectId, projectId));
    }
    if (campaigns.length > 0) {
      await tx.update(collectionCandidates).set({ strategyVersionId, updatedAt: new Date() })
        .where(and(
          inArray(collectionCandidates.campaignId, campaigns.map((campaign) => campaign.id)),
          eq(collectionCandidates.queueStatus, "queued")
        ));
    }
    return active;
  });
}

const masterDossierTemplate = `# Company master dossier

## Executive summary
## Qualification and priority
## Company identity and corporate profile
## Products, services, markets, customers, and competitors
## Business strategy and recent initiatives
## Financial and growth indicators
## Leadership and relevant decision-makers
## Organization, human resources, and hiring intelligence
## Recent news timeline
## Challenges and opportunity signals
## MTI service opportunity map
## Recommended engagement strategy
## Risks and reasons not to pursue
## Evidence gaps and follow-up questions
## Complete source index

For every material claim, include the source URL and date. Clearly distinguish verified fact, inference, sales hypothesis, and unknown information.`;

export async function updateResearchSettings(projectId: string, input: {
  dossierWorkerLimit?: number;
  revisionWorkerLimit?: number;
  queueBufferTarget?: number;
  discoveryEnabled?: boolean;
  researchPaused?: boolean;
}) {
  const database = requireDatabase();
  const [settings] = await database.insert(projectResearchSettings).values({
    organizationId: MTI_ORGANIZATION_ID, projectId, ...input
  }).onConflictDoUpdate({ target: projectResearchSettings.projectId, set: { ...input, updatedAt: new Date() } }).returning();
  return settings;
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
