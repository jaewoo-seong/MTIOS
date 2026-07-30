import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { DOSSIER_DOCUMENT_COLUMN } from "@/lib/collection-columns";
import { db } from "@/lib/db/client";
import { clampCostCeiling } from "@/lib/mcp/platform";
import {
  collectionCampaigns,
  collectionCandidateClaims,
  collectionCandidates,
  collectionDirectives,
  collectionEvidence
} from "@/lib/db/schema";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";

export { DOSSIER_DOCUMENT_COLUMN };

/**
 * Phase 13 Stage 1 - Generic Ledger. A sibling to lib/company-research.ts,
 * not a replacement: that file stays company-specific (canonical registry,
 * multi-tier fuzzy matching, org-wide reuse across projects). This one is
 * schema-agnostic - `entitySchema`/`data` hold whatever fields a campaign's
 * Blueprint step (Stage 2) decided on for that one project, so an
 * "entity" here might be a company, a paper, or a product; dedupe is
 * exact-match on the campaign's own declared keys, scoped per campaign
 * rather than per organization, since two campaigns can describe entities
 * with nothing in common.
 */

export type EntityFieldSchema = { name: string; description: string };

export type CollectionCampaign = {
  id: string;
  projectId: string;
  agendaId: string | null;
  name: string;
  entitySchema: EntityFieldSchema[];
  documentTemplate: string;
  dedupeKeys: string[];
  qualificationRules: string[];
  targetCount: number | null;
  saturationRule: string | null;
  status: string;
  discoveredCount: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  saturationReason: string | null;
  databaseId: string | null;
  changeSetId: string | null;
  costCents: number;
  researchCostCents: number;
  priorSpentCents: number;
  ceilingCents: number | null;
};

export type DossierStatus = "pending" | "completed" | "disqualified" | "failed";

export type CollectionCandidate = {
  id: string;
  campaignId: string;
  fingerprint: string;
  data: Record<string, unknown>;
  resolution: "new" | "duplicate";
  resolutionReason: string | null;
  dossierStatus: DossierStatus;
  dossierMarkdown: string | null;
  dossierReason: string | null;
  linkedRecordId: string | null;
  linkedDocumentId: string | null;
};

export type CollectionCoverage = {
  campaignId: string;
  targetCount: number | null;
  discovered: number;
  duplicates: number;
  accepted: number;
  rejected: number;
  remaining: number | null;
  saturated: boolean;
  saturationReason: string | null;
};

type MemoryCandidate = CollectionCandidate & { lastSeenAt: Date };
type MemoryClaim = {
  campaignId: string;
  candidateId: string;
  workerRunId: string | null;
  leaseToken: string;
  leaseExpiresAt: Date;
  releasedAt: Date | null;
};
type MemoryDirective = CollectionDirective & { campaignId: string };
type MemoryEvidence = {
  id: string;
  campaignId: string;
  candidateId: string | null;
  query: string;
  queryNormalized: string;
  queryEmbedding: number[] | null;
  evidence: unknown;
  reuseCount: number;
};

const globalCollection = globalThis as typeof globalThis & {
  __collectionResearchMemory?: {
    campaigns: CollectionCampaign[];
    candidates: MemoryCandidate[];
    claims: MemoryClaim[];
    directives: MemoryDirective[];
    evidence: MemoryEvidence[];
  };
};
const memory = globalCollection.__collectionResearchMemory ??= {
  campaigns: [],
  candidates: [],
  claims: [],
  directives: [],
  evidence: []
};
// Older in-process stores predate these two collections; a dev-mode hot
// reload keeps the object identity, so default them rather than assume shape.
memory.directives ??= [];
memory.evidence ??= [];

/** Normalizes a raw field value into a comparable token for fingerprinting. */
function normalizeValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function candidateFingerprint(dedupeKeys: string[], data: Record<string, unknown>) {
  const identity = dedupeKeys.map((key) => `${key}:${normalizeValue(data[key])}`).join("|");
  return createHash("sha256").update(identity).digest("hex");
}

function campaignRow(row: typeof collectionCampaigns.$inferSelect): CollectionCampaign {
  return {
    id: row.id,
    projectId: row.projectId,
    agendaId: row.agendaId,
    name: row.name,
    entitySchema: row.entitySchema,
    documentTemplate: row.documentTemplate,
    dedupeKeys: row.dedupeKeys,
    qualificationRules: row.qualificationRules,
    targetCount: row.targetCount,
    saturationRule: row.saturationRule,
    status: row.status,
    discoveredCount: row.discoveredCount,
    acceptedCount: row.acceptedCount,
    rejectedCount: row.rejectedCount,
    duplicateCount: row.duplicateCount,
    saturationReason: row.saturationReason,
    databaseId: row.databaseId,
    changeSetId: row.changeSetId,
    costCents: row.costCents,
    researchCostCents: row.researchCostCents,
    priorSpentCents: row.priorSpentCents,
    ceilingCents: row.ceilingCents
  };
}

function candidateRow(row: typeof collectionCandidates.$inferSelect): CollectionCandidate {
  return {
    id: row.id,
    campaignId: row.campaignId,
    fingerprint: row.fingerprint,
    data: row.data,
    resolution: row.resolution as CollectionCandidate["resolution"],
    resolutionReason: row.resolutionReason,
    dossierStatus: row.dossierStatus as DossierStatus,
    dossierMarkdown: row.dossierMarkdown,
    dossierReason: row.dossierReason,
    linkedRecordId: row.linkedRecordId,
    linkedDocumentId: row.linkedDocumentId
  };
}

export async function createCollectionCampaign(input: {
  projectId: string;
  agendaId?: string | null;
  name: string;
  entitySchema: EntityFieldSchema[];
  documentTemplate: string;
  dedupeKeys: string[];
  qualificationRules?: string[];
  targetCount?: number | null;
  saturationRule?: string | null;
  ceilingCents?: number | null;
}): Promise<CollectionCampaign> {
  if (input.dedupeKeys.length === 0) {
    throw new Error("A collection campaign needs at least one dedupe key.");
  }
  const ceilingCents = normalizeCeiling(input.ceilingCents);
  if (!db) {
    const campaign: CollectionCampaign = {
      id: randomUUID(),
      projectId: input.projectId,
      agendaId: input.agendaId ?? null,
      name: input.name,
      entitySchema: input.entitySchema,
      documentTemplate: input.documentTemplate,
      dedupeKeys: input.dedupeKeys,
      qualificationRules: input.qualificationRules ?? [],
      targetCount: input.targetCount ?? null,
      saturationRule: input.saturationRule ?? null,
      status: "active",
      discoveredCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
      saturationReason: null,
      databaseId: null,
      changeSetId: null,
      costCents: 0,
      researchCostCents: 0,
      priorSpentCents: 0,
      ceilingCents
    };
    memory.campaigns.push(campaign);
    return campaign;
  }
  const [row] = await db.insert(collectionCampaigns).values({
    organizationId: MTI_ORGANIZATION_ID,
    projectId: input.projectId,
    agendaId: input.agendaId ?? null,
    name: input.name,
    entitySchema: input.entitySchema,
    documentTemplate: input.documentTemplate,
    dedupeKeys: input.dedupeKeys,
    qualificationRules: input.qualificationRules ?? [],
    targetCount: input.targetCount ?? null,
    saturationRule: input.saturationRule ?? null,
    status: "active",
    ceilingCents
  }).returning();
  return campaignRow(row);
}

/**
 * A ceiling is an authorization, so an unusable one is rejected rather than
 * quietly coerced: a zero or negative ceiling would read as "campaign
 * immediately exhausted", which is indistinguishable from a finished campaign
 * at the surface.
 */
function normalizeCeiling(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("A campaign spend ceiling must be a positive number of cents.");
  }
  return Math.min(Math.floor(value), CAMPAIGN_MAX_CEILING_CENTS);
}

/**
 * Raises or lowers a live campaign's ceiling. Separate from
 * createCollectionCampaign because the case that matters is a campaign that
 * has already stopped short: the person sees "stopped at its ceiling", raises
 * it, and continues the same campaign rather than starting a new one that
 * would rediscover everything from scratch.
 */
export async function setCollectionCampaignCeiling(
  campaignId: string,
  ceilingCents: number | null
): Promise<CollectionCampaign | null> {
  const normalized = normalizeCeiling(ceilingCents);
  if (!db) {
    const campaign = memory.campaigns.find((item) => item.id === campaignId);
    if (!campaign) return null;
    campaign.ceilingCents = normalized;
    return campaign;
  }
  const [row] = await db.update(collectionCampaigns)
    .set({ ceilingCents: normalized, updatedAt: new Date() })
    .where(and(
      eq(collectionCampaigns.id, campaignId),
      eq(collectionCampaigns.organizationId, MTI_ORGANIZATION_ID)
    )).returning();
  return row ? campaignRow(row) : null;
}

export async function listCollectionCampaigns(projectId?: string): Promise<CollectionCampaign[]> {
  if (!db) {
    return memory.campaigns.filter((item) => !projectId || item.projectId === projectId);
  }
  const rows = await db.select().from(collectionCampaigns).where(
    projectId
      ? and(
          eq(collectionCampaigns.organizationId, MTI_ORGANIZATION_ID),
          eq(collectionCampaigns.projectId, projectId)
        )
      : eq(collectionCampaigns.organizationId, MTI_ORGANIZATION_ID)
  ).orderBy(desc(collectionCampaigns.createdAt));
  return rows.map(campaignRow);
}

export async function getCollectionCampaign(campaignId: string): Promise<CollectionCampaign | null> {
  if (!db) return memory.campaigns.find((item) => item.id === campaignId) ?? null;
  const [row] = await db.select().from(collectionCampaigns).where(and(
    eq(collectionCampaigns.id, campaignId),
    eq(collectionCampaigns.organizationId, MTI_ORGANIZATION_ID)
  )).limit(1);
  return row ? campaignRow(row) : null;
}

export async function addCollectionCandidate(
  campaignId: string,
  data: Record<string, unknown>
): Promise<{ candidateId: string; resolution: "new" | "duplicate" }> {
  const campaign = await getCollectionCampaign(campaignId);
  if (!campaign) throw new Error("Collection campaign not found.");
  const fingerprint = candidateFingerprint(campaign.dedupeKeys, data);

  if (!db) {
    const existing = memory.candidates.find(
      (item) => item.campaignId === campaignId && item.fingerprint === fingerprint
    );
    const owner = memory.campaigns.find((item) => item.id === campaignId);
    if (existing) {
      existing.lastSeenAt = new Date();
      // The candidate row's own `resolution` describes its identity ("this is
      // a new entity we've never seen"), not the outcome of this particular
      // add attempt — a re-discovery doesn't retroactively make the entity
      // less new. The re-discovery count lives on the campaign instead, which
      // is what the Scouting Loop's saturation check (Stage 3) actually reads.
      if (owner) owner.duplicateCount += 1;
      return { candidateId: existing.id, resolution: "duplicate" };
    }
    const candidate: MemoryCandidate = {
      id: randomUUID(), campaignId, fingerprint, data,
      resolution: "new", resolutionReason: null,
      dossierStatus: "pending", dossierMarkdown: null, dossierReason: null,
      linkedRecordId: null, linkedDocumentId: null, lastSeenAt: new Date()
    };
    memory.candidates.push(candidate);
    if (owner) owner.discoveredCount += 1;
    return { candidateId: candidate.id, resolution: "new" };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: collectionCandidates.id })
      .from(collectionCandidates)
      .where(and(
        eq(collectionCandidates.campaignId, campaignId),
        eq(collectionCandidates.fingerprint, fingerprint)
      )).limit(1);
    if (existing) {
      await tx.update(collectionCandidates).set({ lastSeenAt: new Date(), updatedAt: new Date() })
        .where(eq(collectionCandidates.id, existing.id));
      await tx.update(collectionCampaigns)
        .set({ duplicateCount: sql`${collectionCampaigns.duplicateCount} + 1`, updatedAt: new Date() })
        .where(eq(collectionCampaigns.id, campaignId));
      return { candidateId: existing.id, resolution: "duplicate" as const };
    }
    const [candidate] = await tx.insert(collectionCandidates).values({
      organizationId: MTI_ORGANIZATION_ID,
      campaignId,
      fingerprint,
      data,
      resolution: "new"
    }).returning({ id: collectionCandidates.id });
    await tx.update(collectionCampaigns)
      .set({ discoveredCount: sql`${collectionCampaigns.discoveredCount} + 1`, updatedAt: new Date() })
      .where(eq(collectionCampaigns.id, campaignId));
    return { candidateId: candidate.id, resolution: "new" as const };
  });
}

export async function listCollectionCandidates(campaignId: string): Promise<CollectionCandidate[]> {
  if (!db) return memory.candidates.filter((item) => item.campaignId === campaignId);
  const rows = await db.select().from(collectionCandidates)
    .where(eq(collectionCandidates.campaignId, campaignId));
  return rows.map(candidateRow);
}

export function collectionCoverage(campaign: CollectionCampaign): CollectionCoverage {
  // Read the campaign's own running counters rather than recomputing from
  // candidate rows: a candidate's stored `resolution` is its identity ("this
  // entity is new"), which never changes on a re-discovery, so scanning rows
  // by resolution would always read zero duplicates.
  const discovered = campaign.discoveredCount;
  return {
    campaignId: campaign.id,
    targetCount: campaign.targetCount,
    discovered,
    duplicates: campaign.duplicateCount,
    accepted: campaign.acceptedCount,
    rejected: campaign.rejectedCount,
    remaining: campaign.targetCount === null ? null : Math.max(0, campaign.targetCount - discovered),
    saturated: campaign.status === "saturated",
    saturationReason: campaign.saturationReason
  };
}

export async function getCollectionCoverage(campaignId: string): Promise<CollectionCoverage | null> {
  const campaign = await getCollectionCampaign(campaignId);
  return campaign ? collectionCoverage(campaign) : null;
}

/**
 * Claims one candidate for one worker using a Postgres advisory lock scoped
 * to `campaignId:candidateId` - the exact primitive claimCandidate already
 * uses in lib/company-research.ts, unchanged. Returns null when another
 * worker already holds an unexpired lease; a crashed worker's lease expires
 * on its own and the candidate becomes claimable again.
 */
export async function claimCollectionCandidate(input: {
  campaignId: string;
  candidateId: string;
  workerRunId?: string | null;
  leaseSeconds?: number;
}): Promise<{ leaseToken: string; leaseExpiresAt: Date } | null> {
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseSeconds ?? 300) * 1000);

  if (!db) {
    const existing = memory.claims.find((claim) =>
      claim.campaignId === input.campaignId && claim.candidateId === input.candidateId
    );
    if (existing && !existing.releasedAt && existing.leaseExpiresAt > now) return null;
    if (existing) {
      Object.assign(existing, { workerRunId: input.workerRunId ?? null, leaseToken, leaseExpiresAt, releasedAt: null });
    } else {
      memory.claims.push({
        campaignId: input.campaignId, candidateId: input.candidateId,
        workerRunId: input.workerRunId ?? null, leaseToken, leaseExpiresAt, releasedAt: null
      });
    }
    return { leaseToken, leaseExpiresAt };
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.campaignId}:${input.candidateId}`}))`);
    const [existing] = await tx.select().from(collectionCandidateClaims).where(and(
      eq(collectionCandidateClaims.campaignId, input.campaignId),
      eq(collectionCandidateClaims.candidateId, input.candidateId)
    )).limit(1);
    if (existing && !existing.releasedAt && existing.leaseExpiresAt > now) return null;
    if (existing) {
      await tx.update(collectionCandidateClaims).set({
        workerRunId: input.workerRunId ?? null, leaseToken, leaseExpiresAt, releasedAt: null
      }).where(eq(collectionCandidateClaims.id, existing.id));
    } else {
      await tx.insert(collectionCandidateClaims).values({
        organizationId: MTI_ORGANIZATION_ID,
        campaignId: input.campaignId,
        candidateId: input.candidateId,
        workerRunId: input.workerRunId ?? null,
        leaseToken,
        leaseExpiresAt
      });
    }
    return { leaseToken, leaseExpiresAt };
  });
}

export async function releaseCollectionCandidateClaim(
  campaignId: string,
  candidateId: string,
  leaseToken: string
) {
  if (!db) {
    const claim = memory.claims.find((item) =>
      item.campaignId === campaignId &&
      item.candidateId === candidateId &&
      item.leaseToken === leaseToken
    );
    if (!claim) return false;
    claim.releasedAt = new Date();
    return true;
  }
  const rows = await db.update(collectionCandidateClaims).set({ releasedAt: new Date() }).where(and(
    eq(collectionCandidateClaims.campaignId, campaignId),
    eq(collectionCandidateClaims.candidateId, candidateId),
    eq(collectionCandidateClaims.leaseToken, leaseToken)
  )).returning({ id: collectionCandidateClaims.id });
  return rows.length > 0;
}

/** The fan-out list for Stage 4 (Dossier Loop) - one candidate per worker. */
export async function listPendingDossierCandidates(campaignId: string): Promise<CollectionCandidate[]> {
  if (!db) {
    return memory.candidates.filter(
      (item) => item.campaignId === campaignId && item.dossierStatus === "pending"
    );
  }
  const rows = await db.select().from(collectionCandidates).where(and(
    eq(collectionCandidates.campaignId, campaignId),
    eq(collectionCandidates.dossierStatus, "pending")
  ));
  return rows.map(candidateRow);
}

/**
 * Stage 4 (Dossier Loop) result for one candidate. `data` is merged over
 * whatever Stage 3 already recorded, not replaced - the dossier worker
 * fills gaps and corrects fields, it does not re-discover the entity from
 * scratch. Also rolls the outcome into the campaign's own
 * accepted/rejected counters, mirroring how Stage 1 keeps duplicateCount on
 * the campaign rather than making callers recompute it from candidate rows.
 */
export async function recordDossierResult(
  candidateId: string,
  result: {
    status: Exclude<DossierStatus, "pending">;
    data?: Record<string, unknown>;
    markdown?: string | null;
    reason?: string | null;
  }
): Promise<CollectionCandidate | null> {
  if (!db) {
    const candidate = memory.candidates.find((item) => item.id === candidateId);
    if (!candidate) return null;
    if (result.data) candidate.data = { ...candidate.data, ...result.data };
    candidate.dossierStatus = result.status;
    candidate.dossierMarkdown = result.markdown ?? candidate.dossierMarkdown;
    candidate.dossierReason = result.reason ?? candidate.dossierReason;
    const owner = memory.campaigns.find((item) => item.id === candidate.campaignId);
    if (owner) {
      if (result.status === "completed") owner.acceptedCount += 1;
      if (result.status === "disqualified") owner.rejectedCount += 1;
    }
    return candidate;
  }
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ data: collectionCandidates.data, campaignId: collectionCandidates.campaignId })
      .from(collectionCandidates).where(eq(collectionCandidates.id, candidateId)).limit(1);
    if (!existing) return null;
    const [row] = await tx.update(collectionCandidates).set({
      data: result.data ? { ...existing.data, ...result.data } : existing.data,
      dossierStatus: result.status,
      ...(result.markdown !== undefined ? { dossierMarkdown: result.markdown } : {}),
      ...(result.reason !== undefined ? { dossierReason: result.reason } : {}),
      updatedAt: new Date()
    }).where(eq(collectionCandidates.id, candidateId)).returning();
    if (result.status === "completed" || result.status === "disqualified") {
      await tx.update(collectionCampaigns).set({
        ...(result.status === "completed"
          ? { acceptedCount: sql`${collectionCampaigns.acceptedCount} + 1` }
          : { rejectedCount: sql`${collectionCampaigns.rejectedCount} + 1` }),
        updatedAt: new Date()
      }).where(eq(collectionCampaigns.id, existing.campaignId));
    }
    return row ? candidateRow(row) : null;
  });
}

/** Records where Stage 5 (Cross-Link) put this candidate's row and document once they exist. */
export async function setCollectionCandidateLinks(
  candidateId: string,
  links: { recordId?: string | null; documentId?: string | null }
): Promise<CollectionCandidate | null> {
  if (!db) {
    const candidate = memory.candidates.find((item) => item.id === candidateId);
    if (!candidate) return null;
    if (links.recordId !== undefined) candidate.linkedRecordId = links.recordId;
    if (links.documentId !== undefined) candidate.linkedDocumentId = links.documentId;
    return candidate;
  }
  const values: Partial<typeof collectionCandidates.$inferInsert> = { updatedAt: new Date() };
  if (links.recordId !== undefined) values.linkedRecordId = links.recordId;
  if (links.documentId !== undefined) values.linkedDocumentId = links.documentId;
  const [row] = await db.update(collectionCandidates).set(values)
    .where(eq(collectionCandidates.id, candidateId)).returning();
  return row ? candidateRow(row) : null;
}

/**
 * Phase 13 Guardrails. A collection campaign is the one place in this system
 * where a single instruction can fan out into hundreds of paid model calls,
 * so it gets a spend ceiling on top of the step caps in Stages 3 and 4.
 *
 * The default is deliberately low. An instruction like "find every company
 * on Kickstarter" is not a budget authorization, and the failure mode to
 * design against is an underspecified instruction quietly running up spend -
 * not a well-specified one stopping slightly early, which a person can see
 * and raise.
 */
export const CAMPAIGN_DEFAULT_CEILING_CENTS = 500;

/**
 * The ceiling on ceilings. A per-campaign ceiling exists so a deliberately
 * large campaign is expressible, not so spend becomes unbounded — a typo that
 * adds a digit should still hit something.
 */
export const CAMPAIGN_MAX_CEILING_CENTS = 100_000;

/**
 * Hard ceiling on how many candidates one run will research, independent of
 * what the campaign asked for. The working limit is `dossierFanoutLimit`; this
 * exists so a campaign with no target, or a discovery step that ran away,
 * still hits something.
 */
export const DOSSIER_FANOUT_HARD_LIMIT = 500;

/**
 * How many candidates one run will research, given what the campaign was
 * actually asked for.
 *
 * The old fixed limit of 100 sat exactly on the most obvious target a person
 * would ask for, which left a request for 100 entities with no headroom at
 * all: discovery finding 108 candidates to yield 100 qualifying ones would
 * strand eight of them with nothing to pick them up. Headroom is proportional
 * rather than fixed because the disqualification rate is a property of the
 * criteria, not of the count.
 */
export function dossierFanoutLimit(targetCount: number | null | undefined) {
  if (targetCount === null || targetCount === undefined) return DOSSIER_FANOUT_HARD_LIMIT;
  return Math.min(DOSSIER_FANOUT_HARD_LIMIT, Math.ceil(targetCount * 1.5) + 10);
}

/**
 * Per-entity spend allowance used to size a campaign's ceiling from its target.
 *
 * Derived from what one entity actually costs: a query-planning call, up to
 * four external searches at about a credit each, a field extraction, and a
 * document write. Ten cents sits comfortably above that on the routes these
 * workers use, so a campaign stops because it finished rather than because the
 * allowance was too tight to finish on.
 */
export const CAMPAIGN_CENTS_PER_ENTITY = 10;

/**
 * The ceiling a campaign should be created with, sized from its target.
 *
 * Returns null for an open-ended campaign, which leaves it on the low default
 * deliberately: "find everything" is not a spend authorization, and the
 * failure to design against is an underspecified instruction quietly running
 * up cost.
 */
export function campaignCeilingCents(targetCount: number | null | undefined) {
  if (targetCount === null || targetCount === undefined) return null;
  return Math.min(
    CAMPAIGN_MAX_CEILING_CENTS,
    Math.max(CAMPAIGN_DEFAULT_CEILING_CENTS, targetCount * CAMPAIGN_CENTS_PER_ENTITY)
  );
}

export type CollectionBudget = {
  ceilingCents: number;
  spentCents: number;
  modelCostCents: number;
  researchCostCents: number;
  remainingCents: number;
  exhausted: boolean;
  /** Which of the two ceilings is actually binding, so the surface can say so. */
  ceilingSource: "campaign" | "default" | "project";
};

/**
 * Reads what a campaign has spent so far and whether it may keep going.
 *
 * Two kinds of spend are counted, because a collection campaign is the one
 * place in this system where they trade places. Model spend dominates a small
 * campaign; external search credits dominate a large one, at roughly one
 * credit per query and four queries per entity. Counting only model calls -
 * which is all `runs.cost_micros` tracks - left the guardrail watching the
 * cheaper half and blind to the half that actually scales with entity count.
 *
 * The ceiling is the campaign's own authorization, falling back to a
 * deliberately low default when none was set, and then clamped by the
 * project's budget through the same clampCostCeiling the MCP layer uses. So a
 * project budget still only ever tightens, while a campaign that was
 * explicitly authorized for a larger run can actually have one.
 */
export async function getCollectionBudget(
  campaignId: string,
  deps: {
    getRunCostMicros: () => Promise<number>;
    getProjectBudgetCents: (projectId: string) => Promise<number | null>;
    /** Omitted only by callers that predate research-cost accounting. */
    getResearchCostCents?: () => Promise<number>;
  }
): Promise<CollectionBudget> {
  const campaign = await getCollectionCampaign(campaignId);
  if (!campaign) throw new Error("Collection campaign not found.");
  const authorized = campaign.ceilingCents ?? CAMPAIGN_DEFAULT_CEILING_CENTS;
  const projectBudget = await deps.getProjectBudgetCents(campaign.projectId);
  const ceilingCents = clampCostCeiling(authorized, projectBudget) ?? authorized;
  // Round spend up, never down: charging a fraction of a cent as zero would
  // let a long run of cheap calls accumulate real cost against a ceiling that
  // never appears to move.
  const modelCostCents = Math.ceil(await deps.getRunCostMicros() / 10_000);
  // Research spend is already whole cents at the provider level, and is read
  // from the research ledger rather than re-derived, so the figure here is the
  // same one the research surface reports.
  const researchCostCents = Math.max(0, Math.round(await deps.getResearchCostCents?.() ?? 0));
  // Spend carried from earlier runs of this same campaign. Without it, every
  // continuation would start from zero and the ceiling would bound a single
  // run rather than the campaign.
  const spentCents = campaign.priorSpentCents + modelCostCents + researchCostCents;
  await recordCollectionCampaignSpend(campaignId, spentCents, researchCostCents);
  return {
    ceilingCents,
    spentCents,
    modelCostCents,
    researchCostCents,
    remainingCents: Math.max(0, ceilingCents - spentCents),
    exhausted: spentCents >= ceilingCents,
    ceilingSource: ceilingCents === projectBudget && projectBudget < authorized
      ? "project"
      : campaign.ceilingCents === null ? "default" : "campaign"
  };
}

async function recordCollectionCampaignSpend(
  campaignId: string,
  spentCents: number,
  researchCostCents: number
) {
  if (!db) {
    const campaign = memory.campaigns.find((item) => item.id === campaignId);
    if (campaign) {
      campaign.costCents = spentCents;
      campaign.researchCostCents = researchCostCents;
    }
    return;
  }
  await db.update(collectionCampaigns)
    .set({ costCents: spentCents, researchCostCents, updatedAt: new Date() })
    .where(eq(collectionCampaigns.id, campaignId));
}

/**
 * Phase 13 Stage 5 - Cross-Link. Publishes every completed dossier as a
 * document plus a proposed client-data row, linked to each other.
 *
 * The asymmetry between the two writes is deliberate. Documents are the
 * workspace's own artifacts, so they are created outright. Client-data rows
 * are not: they go through the Phase 8 staged-change flow as a single
 * reviewable change set, which means this function proposes rows and does
 * not create them. `linkedRecordId` therefore stays null until a human
 * approves and applies that change set - see
 * reconcileCollectionRecordLinks below, which closes the loop afterwards.
 */
export async function crossLinkCollectionCampaign(
  campaignId: string,
  deps: {
    createDocument: (input: {
      folderId: string;
      projectId: string | null;
      title: string;
      markdown: string;
    }) => Promise<{ id: string }>;
    resolveFolderId: () => Promise<string>;
    ensureDatabase: (name: string, description: string) => Promise<{ id: string }>;
    createChangeSet: (input: {
      projectId: string;
      agendaId: string | null;
      databaseId: string;
      title: string;
      reason: string;
      idempotencyKey: string;
      items: Array<{ operation: "insert"; after: Record<string, string> }>;
    }) => Promise<{ id: string }>;
    submitChangeSet: (changeSetId: string) => Promise<unknown>;
  }
): Promise<{
  campaignId: string;
  databaseId: string | null;
  changeSetId: string | null;
  published: number;
  skipped: number;
}> {
  const campaign = await getCollectionCampaign(campaignId);
  if (!campaign) throw new Error("Collection campaign not found.");

  const candidates = (await listCollectionCandidates(campaignId)).filter(
    (candidate) => candidate.dossierStatus === "completed"
  );
  // Already-linked candidates are skipped rather than duplicated, so a rerun
  // after a partial failure publishes only what is still missing.
  const unpublished = candidates.filter((candidate) => candidate.linkedDocumentId === null);
  if (unpublished.length === 0) {
    return {
      campaignId,
      databaseId: campaign.databaseId,
      changeSetId: campaign.changeSetId,
      published: 0,
      skipped: candidates.length
    };
  }

  const database = campaign.databaseId
    ? { id: campaign.databaseId }
    : await deps.ensureDatabase(campaign.name, `Entities collected by the "${campaign.name}" campaign.`);
  const folderId = await deps.resolveFolderId();

  const items: Array<{ operation: "insert"; after: Record<string, string> }> = [];
  for (const candidate of unpublished) {
    const title = candidateTitle(campaign, candidate);
    const document = await deps.createDocument({
      folderId,
      projectId: campaign.projectId,
      title,
      markdown: candidate.dossierMarkdown ?? ""
    });
    await setCollectionCandidateLinks(candidate.id, { documentId: document.id });
    items.push({
      operation: "insert",
      after: {
        // Only the campaign's own declared fields become columns - an
        // extraction step that returned extra keys must not silently widen
        // the shape the user agreed to.
        ...Object.fromEntries(campaign.entitySchema.map((field) => [
          field.name,
          candidate.data[field.name] === undefined || candidate.data[field.name] === null
            ? ""
            : String(candidate.data[field.name])
        ])),
        [DOSSIER_DOCUMENT_COLUMN]: document.id
      }
    });
  }

  const changeSet = await deps.createChangeSet({
    projectId: campaign.projectId,
    agendaId: campaign.agendaId,
    databaseId: database.id,
    title: `${campaign.name}: ${items.length} collected entit${items.length === 1 ? "y" : "ies"}`,
    reason: `Proposed by the "${campaign.name}" collection campaign. Each row links to its dossier document.`,
    // Scoped to the campaign and the row count so a rerun that found more
    // entities creates a new set rather than silently returning the old one.
    idempotencyKey: `collection:${campaignId}:${items.length}`,
    items
  });
  await deps.submitChangeSet(changeSet.id);
  await setCollectionCampaignPublication(campaignId, {
    databaseId: database.id,
    changeSetId: changeSet.id
  });

  return {
    campaignId,
    databaseId: database.id,
    changeSetId: changeSet.id,
    published: items.length,
    skipped: candidates.length - items.length
  };
}

function candidateTitle(campaign: CollectionCampaign, candidate: CollectionCandidate) {
  const primary = campaign.dedupeKeys
    .map((key) => candidate.data[key])
    .find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof primary === "string" ? primary.slice(0, 180) : `${campaign.name} entity`;
}

async function setCollectionCampaignPublication(
  campaignId: string,
  input: { databaseId: string; changeSetId: string }
) {
  if (!db) {
    const campaign = memory.campaigns.find((item) => item.id === campaignId);
    if (campaign) Object.assign(campaign, input);
    return;
  }
  await db.update(collectionCampaigns).set({ ...input, updatedAt: new Date() })
    .where(eq(collectionCampaigns.id, campaignId));
}

/**
 * Completes the record half of the cross-link once the campaign's change set
 * has actually been applied. The join key is the dossier document id carried
 * in each row - unique per candidate, and already known on both sides - so
 * this needs no extra bookkeeping column and is safe to run repeatedly.
 */
export async function reconcileCollectionRecordLinks(
  campaignId: string,
  deps: {
    getChangeSetStatus: (changeSetId: string) => Promise<string | null>;
    listRecords: (databaseId: string) => Promise<Array<{ id: string; data: Record<string, string> }>>;
  }
): Promise<{ linked: number; pendingApproval: boolean }> {
  const campaign = await getCollectionCampaign(campaignId);
  if (!campaign?.changeSetId || !campaign.databaseId) return { linked: 0, pendingApproval: false };
  const status = await deps.getChangeSetStatus(campaign.changeSetId);
  if (status !== "applied") return { linked: 0, pendingApproval: true };

  const records = await deps.listRecords(campaign.databaseId);
  const byDocument = new Map(
    records
      .filter((record) => record.data[DOSSIER_DOCUMENT_COLUMN])
      .map((record) => [record.data[DOSSIER_DOCUMENT_COLUMN], record.id])
  );
  let linked = 0;
  for (const candidate of await listCollectionCandidates(campaignId)) {
    if (!candidate.linkedDocumentId || candidate.linkedRecordId) continue;
    const recordId = byDocument.get(candidate.linkedDocumentId);
    if (!recordId) continue;
    await setCollectionCandidateLinks(candidate.id, { recordId });
    linked += 1;
  }
  return { linked, pendingApproval: false };
}

export async function markCollectionCampaignSaturated(campaignId: string, reason: string) {
  if (!db) {
    const campaign = memory.campaigns.find((item) => item.id === campaignId);
    if (!campaign) return null;
    campaign.status = "saturated";
    campaign.saturationReason = reason;
    return campaign;
  }
  const [row] = await db.update(collectionCampaigns).set({
    status: "saturated",
    saturationReason: reason,
    updatedAt: new Date()
  }).where(and(
    eq(collectionCampaigns.id, campaignId),
    eq(collectionCampaigns.organizationId, MTI_ORGANIZATION_ID)
  )).returning();
  return row ? campaignRow(row) : null;
}

/**
 * Phase 13 Steering. A directive redirects a campaign that is already running
 * without discarding what it has finished.
 *
 * The reason this can be a table rather than a signalling mechanism is that
 * both loops already call the app once per iteration for their budget check,
 * so there is an existing, regular moment at which new instructions can be
 * picked up. Absorption happens at that moment, which is why a directive
 * changes what happens *next* and never interrupts work in flight: a dossier
 * worker mid-entity finishes that entity, and the directive applies to
 * candidates nobody has claimed yet.
 *
 * `status` carries the whole guarantee. A directive is pending until some loop
 * reads it and marks it absorbed, so it is applied exactly once; and one
 * written after a campaign ends simply stays pending rather than leaking into
 * an unrelated later run.
 */
export const directiveKinds = ["refocus", "add_criteria", "stop_discovery"] as const;
export type DirectiveKind = typeof directiveKinds[number];

export type CollectionDirective = {
  id: string;
  kind: DirectiveKind;
  instruction: string;
  status: "pending" | "absorbed";
  absorbedStage: string | null;
  createdAt: string;
  absorbedAt: string | null;
};

function directiveRow(row: typeof collectionDirectives.$inferSelect): CollectionDirective {
  return {
    id: row.id,
    kind: row.kind as DirectiveKind,
    instruction: row.instruction,
    status: row.status as CollectionDirective["status"],
    absorbedStage: row.absorbedStage,
    createdAt: row.createdAt.toISOString(),
    absorbedAt: row.absorbedAt?.toISOString() ?? null
  };
}

export async function addCollectionDirective(input: {
  campaignId: string;
  kind: DirectiveKind;
  instruction: string;
  createdBy?: string | null;
}): Promise<CollectionDirective> {
  const campaign = await getCollectionCampaign(input.campaignId);
  if (!campaign) throw new Error("Collection campaign not found.");
  // A refocus or added criterion with no text is not a usable instruction -
  // the model would receive an empty steer and silently carry on unchanged,
  // which looks to the person like steering that did not work.
  const instruction = input.instruction.trim();
  if (input.kind !== "stop_discovery" && instruction.length === 0) {
    throw new Error(`A "${input.kind}" directive needs instruction text.`);
  }
  if (!db) {
    const directive: MemoryDirective = {
      id: randomUUID(),
      campaignId: input.campaignId,
      kind: input.kind,
      instruction,
      status: "pending",
      absorbedStage: null,
      createdAt: new Date().toISOString(),
      absorbedAt: null
    };
    memory.directives.push(directive);
    return directive;
  }
  const [row] = await db.insert(collectionDirectives).values({
    organizationId: MTI_ORGANIZATION_ID,
    campaignId: input.campaignId,
    kind: input.kind,
    instruction,
    createdBy: input.createdBy ?? null
  }).returning();
  return directiveRow(row);
}

export async function listCollectionDirectives(campaignId: string): Promise<CollectionDirective[]> {
  if (!db) {
    return memory.directives
      .filter((item) => item.campaignId === campaignId)
      .map(({ campaignId: _campaignId, ...directive }) => directive);
  }
  const rows = await db.select().from(collectionDirectives)
    .where(eq(collectionDirectives.campaignId, campaignId))
    .orderBy(collectionDirectives.createdAt);
  return rows.map(directiveRow);
}

/**
 * Which directive kinds a given stage is allowed to consume.
 *
 * Dossier workers deliberately only take `add_criteria`. A `refocus` or
 * `stop_discovery` is an instruction about *finding* entities, and a dossier
 * worker consuming one would mark it absorbed without acting on it - quietly
 * swallowing a steer the discovery loop was the only thing able to honour.
 * Leaving those pending also means a later continuation that resumes discovery
 * still picks them up, which is what the operator asked for.
 */
const STAGE_DIRECTIVES: Record<string, readonly DirectiveKind[]> = {
  scouting: directiveKinds,
  dossier: ["add_criteria"]
};

/**
 * Takes the pending directives a stage can act on and marks them absorbed in
 * one step, returning what was taken.
 *
 * Read-and-claim rather than read-then-mark, because several dossier workers
 * poll concurrently: two of them reading the same pending directive would apply
 * it twice, and a conversation told the same thing twice reads as contradicting
 * itself. The returned list is the caller's alone.
 */
export async function absorbCollectionDirectives(
  campaignId: string,
  stage: string
): Promise<CollectionDirective[]> {
  const allowed = STAGE_DIRECTIVES[stage] ?? directiveKinds;
  if (!db) {
    const pending = memory.directives.filter((item) =>
      item.campaignId === campaignId &&
      item.status === "pending" &&
      allowed.includes(item.kind)
    );
    for (const directive of pending) {
      directive.status = "absorbed";
      directive.absorbedStage = stage;
      directive.absorbedAt = new Date().toISOString();
    }
    return pending.map(({ campaignId: _campaignId, ...directive }) => directive);
  }
  const rows = await db.update(collectionDirectives).set({
    status: "absorbed",
    absorbedStage: stage,
    absorbedAt: new Date(),
    updatedAt: new Date()
  }).where(and(
    eq(collectionDirectives.campaignId, campaignId),
    eq(collectionDirectives.organizationId, MTI_ORGANIZATION_ID),
    eq(collectionDirectives.status, "pending"),
    inArray(collectionDirectives.kind, [...allowed])
  )).returning();
  return rows.map(directiveRow);
}

/**
 * Applies the directives that change durable campaign state, as opposed to the
 * ones that only steer a conversation.
 *
 * `add_criteria` has to be persisted rather than injected, because it must
 * outlive the loop that absorbed it: a criterion added during discovery has to
 * still apply when dossier workers judge whether an entity qualifies, and
 * those workers read the campaign, not the directive log. Already-written
 * dossiers are deliberately left alone - a rule added at entity 60 is not
 * evidence that entities 1 through 59 were judged wrongly.
 */
export async function applyDirectivesToCampaign(
  campaignId: string,
  directives: CollectionDirective[]
): Promise<CollectionCampaign | null> {
  const added = directives
    .filter((directive) => directive.kind === "add_criteria")
    .map((directive) => directive.instruction);
  if (added.length === 0) return getCollectionCampaign(campaignId);
  const campaign = await getCollectionCampaign(campaignId);
  if (!campaign) return null;
  const merged = [...campaign.qualificationRules];
  for (const rule of added) if (!merged.includes(rule)) merged.push(rule);
  if (!db) {
    const stored = memory.campaigns.find((item) => item.id === campaignId);
    if (stored) stored.qualificationRules = merged;
    return stored ?? null;
  }
  const [row] = await db.update(collectionCampaigns)
    .set({ qualificationRules: merged, updatedAt: new Date() })
    .where(and(
      eq(collectionCampaigns.id, campaignId),
      eq(collectionCampaigns.organizationId, MTI_ORGANIZATION_ID)
    )).returning();
  return row ? campaignRow(row) : null;
}

/**
 * Phase 13 shared context. A campaign-scoped pool of search results, so
 * sibling workers stop paying twice for the same question.
 *
 * The problem this solves is specific: every dossier worker planned its own
 * queries seeing only its own entity, so a hundred workers researching a
 * hundred companies in one niche generated overlapping queries that the
 * research engine's own cache mostly missed. That cache keys on the exact
 * query string, so "Acme Corp funding" and "Acme Corporation funding rounds"
 * are two paid lookups for one answer.
 *
 * Two layers, cheapest first. `queryNormalized` catches exact repeats with no
 * model call at all. Embeddings catch the near-miss, but only when an
 * embedding provider is actually configured - retrieval degrades to the
 * normalized match rather than failing when it is not, which is the current
 * state of this deployment.
 */
const EVIDENCE_SIMILARITY_THRESHOLD = 0.92;

export type EvidenceLookup = {
  hit: boolean;
  evidence: unknown;
  matchedQuery: string | null;
  matchKind: "exact" | "semantic" | null;
};

function normalizeQuery(query: string) {
  return query
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cosine(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

/**
 * Looks for evidence this campaign already holds for an equivalent question.
 *
 * `embed` is optional and injected. When it is absent or throws, this falls
 * back to exact normalized matching instead of propagating the failure: a
 * missing embedding provider should cost the campaign some duplicated
 * searches, not stop it.
 */
export async function findCampaignEvidence(
  campaignId: string,
  query: string,
  embed?: (input: string) => Promise<number[]>
): Promise<EvidenceLookup> {
  const miss: EvidenceLookup = { hit: false, evidence: null, matchedQuery: null, matchKind: null };
  const normalized = normalizeQuery(query);
  if (!normalized) return miss;

  const exact = await readEvidenceByNormalizedQuery(campaignId, normalized);
  if (exact) {
    await bumpEvidenceReuse(exact.id);
    return { hit: true, evidence: exact.evidence, matchedQuery: exact.query, matchKind: "exact" };
  }
  if (!embed) return miss;

  let vector: number[];
  try {
    vector = await embed(query);
  } catch {
    return miss;
  }
  const stored = await listEvidenceWithEmbeddings(campaignId);
  let best: { id: string; query: string; evidence: unknown; score: number } | null = null;
  for (const row of stored) {
    if (!row.queryEmbedding) continue;
    const score = cosine(vector, row.queryEmbedding);
    if (score >= EVIDENCE_SIMILARITY_THRESHOLD && (!best || score > best.score)) {
      best = { id: row.id, query: row.query, evidence: row.evidence, score };
    }
  }
  if (!best) return miss;
  await bumpEvidenceReuse(best.id);
  return { hit: true, evidence: best.evidence, matchedQuery: best.query, matchKind: "semantic" };
}

export async function recordCampaignEvidence(input: {
  campaignId: string;
  candidateId?: string | null;
  query: string;
  evidence: unknown;
  embedding?: number[] | null;
}): Promise<void> {
  const normalized = normalizeQuery(input.query);
  if (!normalized) return;
  if (!db) {
    const existing = memory.evidence.find(
      (item) => item.campaignId === input.campaignId && item.queryNormalized === normalized
    );
    if (existing) {
      existing.evidence = input.evidence;
      existing.queryEmbedding = input.embedding ?? existing.queryEmbedding;
      return;
    }
    memory.evidence.push({
      id: randomUUID(),
      campaignId: input.campaignId,
      candidateId: input.candidateId ?? null,
      query: input.query,
      queryNormalized: normalized,
      queryEmbedding: input.embedding ?? null,
      evidence: input.evidence,
      reuseCount: 0
    });
    return;
  }
  await db.insert(collectionEvidence).values({
    organizationId: MTI_ORGANIZATION_ID,
    campaignId: input.campaignId,
    candidateId: input.candidateId ?? null,
    query: input.query,
    queryNormalized: normalized,
    queryEmbedding: input.embedding ?? null,
    evidence: input.evidence
  }).onConflictDoUpdate({
    target: [collectionEvidence.campaignId, collectionEvidence.queryNormalized],
    set: { evidence: input.evidence, updatedAt: new Date() }
  });
}

async function readEvidenceByNormalizedQuery(campaignId: string, normalized: string) {
  if (!db) {
    return memory.evidence.find(
      (item) => item.campaignId === campaignId && item.queryNormalized === normalized
    ) ?? null;
  }
  const [row] = await db.select().from(collectionEvidence).where(and(
    eq(collectionEvidence.campaignId, campaignId),
    eq(collectionEvidence.queryNormalized, normalized)
  )).limit(1);
  return row ?? null;
}

async function listEvidenceWithEmbeddings(campaignId: string) {
  if (!db) {
    return memory.evidence.filter((item) => item.campaignId === campaignId);
  }
  return db.select().from(collectionEvidence)
    .where(eq(collectionEvidence.campaignId, campaignId))
    .limit(500);
}

async function bumpEvidenceReuse(id: string) {
  if (!db) {
    const row = memory.evidence.find((item) => item.id === id);
    if (row) row.reuseCount += 1;
    return;
  }
  await db.update(collectionEvidence)
    .set({ reuseCount: sql`${collectionEvidence.reuseCount} + 1`, updatedAt: new Date() })
    .where(eq(collectionEvidence.id, id));
}

/** Reuse statistics for one campaign, for the surface and for tests. */
export async function getCampaignEvidenceStats(campaignId: string) {
  if (!db) {
    const rows = memory.evidence.filter((item) => item.campaignId === campaignId);
    return {
      storedQueries: rows.length,
      reuseCount: rows.reduce((sum, row) => sum + row.reuseCount, 0)
    };
  }
  const rows = await db.select({ reuseCount: collectionEvidence.reuseCount })
    .from(collectionEvidence)
    .where(eq(collectionEvidence.campaignId, campaignId));
  return {
    storedQueries: rows.length,
    reuseCount: rows.reduce((sum, row) => sum + row.reuseCount, 0)
  };
}

/**
 * Resets a campaign so a continuation run can pick up where the last one
 * stopped.
 *
 * `failed` candidates become `pending` again because the failures worth
 * continuing are the transient ones - a rate-limited provider, a model that
 * returned unparseable JSON once. `disqualified` candidates are deliberately
 * left alone: those were judged against the criteria and the judgement stands.
 *
 * The campaign's status moves off `saturated` only when discovery genuinely
 * has more to do, so continuing a campaign that simply ran out of budget
 * mid-dossier does not restart a discovery phase that had already finished.
 *
 * `currentRunSpentCents` is what makes the spend snapshot safe to repeat. This
 * function is called from a Trigger.dev task that can retry, and freezing
 * spend-to-date a second time would fold the continuation's own spend into the
 * carried figure and count it twice. A run that has already spent something is
 * therefore a run whose snapshot has already been taken.
 */
export async function reopenCollectionCampaign(
  campaignId: string,
  options: {
    retryFailed?: boolean;
    resumeDiscovery?: boolean;
    currentRunSpentCents?: number;
  } = {}
): Promise<{ campaign: CollectionCampaign | null; retried: number }> {
  const campaign = await getCollectionCampaign(campaignId);
  if (!campaign) return { campaign: null, retried: 0 };
  let retried = 0;
  if (options.retryFailed !== false) {
    if (!db) {
      for (const candidate of memory.candidates) {
        if (candidate.campaignId === campaignId && candidate.dossierStatus === "failed") {
          candidate.dossierStatus = "pending";
          candidate.dossierReason = null;
          retried += 1;
        }
      }
    } else {
      const rows = await db.update(collectionCandidates).set({
        dossierStatus: "pending",
        dossierReason: null,
        updatedAt: new Date()
      }).where(and(
        eq(collectionCandidates.campaignId, campaignId),
        eq(collectionCandidates.dossierStatus, "failed")
      )).returning({ id: collectionCandidates.id });
      retried = rows.length;
    }
  }
  const nextStatus = options.resumeDiscovery ? "active" : campaign.status;
  // Freeze what the campaign has spent so far into `priorSpentCents`. The
  // continuation gets a new run whose own counters start at zero, so without
  // this the ceiling would bound each run separately and any number of
  // continuations could walk straight past it. Skipped when the incoming run
  // has already spent something, because that means this is a repeat call and
  // the snapshot would swallow the run's own spend.
  const alreadySnapshotted = (options.currentRunSpentCents ?? 0) > 0;
  const priorSpentCents = alreadySnapshotted
    ? campaign.priorSpentCents
    : campaign.costCents;
  if (!db) {
    const stored = memory.campaigns.find((item) => item.id === campaignId);
    if (stored) {
      stored.priorSpentCents = priorSpentCents;
      if (options.resumeDiscovery) {
        stored.status = "active";
        stored.saturationReason = null;
      }
    }
    return { campaign: stored ?? null, retried };
  }
  const [row] = await db.update(collectionCampaigns).set({
    status: nextStatus,
    priorSpentCents,
    ...(options.resumeDiscovery ? { saturationReason: null } : {}),
    updatedAt: new Date()
  }).where(and(
    eq(collectionCampaigns.id, campaignId),
    eq(collectionCampaigns.organizationId, MTI_ORGANIZATION_ID)
  )).returning();
  return { campaign: row ? campaignRow(row) : null, retried };
}
