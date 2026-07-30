import { and, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { DOSSIER_DOCUMENT_COLUMN } from "@/lib/collection-columns";
import { db } from "@/lib/db/client";
import { clampCostCeiling } from "@/lib/mcp/platform";
import {
  collectionCampaigns,
  collectionCandidateClaims,
  collectionCandidates
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

const globalCollection = globalThis as typeof globalThis & {
  __collectionResearchMemory?: {
    campaigns: CollectionCampaign[];
    candidates: MemoryCandidate[];
    claims: MemoryClaim[];
  };
};
const memory = globalCollection.__collectionResearchMemory ??= {
  campaigns: [],
  candidates: [],
  claims: []
};

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
    changeSetId: row.changeSetId
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
}): Promise<CollectionCampaign> {
  if (input.dedupeKeys.length === 0) {
    throw new Error("A collection campaign needs at least one dedupe key.");
  }
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
      changeSetId: null
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
    status: "active"
  }).returning();
  return campaignRow(row);
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

export async function getCollectionCoverage(campaignId: string): Promise<CollectionCoverage | null> {
  const campaign = await getCollectionCampaign(campaignId);
  if (!campaign) return null;
  // Read the campaign's own running counters rather than recomputing from
  // candidate rows: a candidate's stored `resolution` is its identity ("this
  // entity is new"), which never changes on a re-discovery, so scanning rows
  // by resolution would always read zero duplicates.
  const discovered = campaign.discoveredCount;
  return {
    campaignId,
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

export type CollectionBudget = {
  ceilingCents: number;
  spentCents: number;
  remainingCents: number;
  exhausted: boolean;
};

/**
 * Reads what a campaign has spent so far and whether it may keep going.
 *
 * Spend is read from the run's own running total rather than re-summed here,
 * and the ceiling is clamped by the project's budget through the same
 * clampCostCeiling the MCP layer uses - so a project with a tighter budget
 * tightens its campaigns automatically, and there is one clamping rule in
 * the codebase rather than two that can disagree.
 */
export async function getCollectionBudget(
  campaignId: string,
  deps: {
    getRunCostMicros: () => Promise<number>;
    getProjectBudgetCents: (projectId: string) => Promise<number | null>;
  }
): Promise<CollectionBudget> {
  const campaign = await getCollectionCampaign(campaignId);
  if (!campaign) throw new Error("Collection campaign not found.");
  const ceilingCents = clampCostCeiling(
    CAMPAIGN_DEFAULT_CEILING_CENTS,
    await deps.getProjectBudgetCents(campaign.projectId)
  ) ?? CAMPAIGN_DEFAULT_CEILING_CENTS;
  // Round spend up, never down: charging a fraction of a cent as zero would
  // let a long run of cheap calls accumulate real cost against a ceiling that
  // never appears to move.
  const spentCents = Math.ceil(await deps.getRunCostMicros() / 10_000);
  await recordCollectionCampaignSpend(campaignId, spentCents);
  return {
    ceilingCents,
    spentCents,
    remainingCents: Math.max(0, ceilingCents - spentCents),
    exhausted: spentCents >= ceilingCents
  };
}

async function recordCollectionCampaignSpend(campaignId: string, spentCents: number) {
  if (!db) return;
  await db.update(collectionCampaigns)
    .set({ costCents: spentCents, updatedAt: new Date() })
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
