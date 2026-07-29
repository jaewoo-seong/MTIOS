import { and, eq, isNull, or, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import {
  campaignCandidates,
  canonicalCompanies,
  companyCandidates,
  companyIdentifiers,
  companyProjectLinks,
  companyResearchClaims,
  companySources,
  researchCampaigns
} from "@/lib/db/schema";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";

export type CompanyIdentifierInput = {
  type: string;
  value: string;
  issuingCountry?: string | null;
};

export type CompanyInput = {
  legalName: string;
  tradingNames?: string[];
  domain?: string | null;
  countryCode?: string | null;
  locations?: Array<Record<string, string>>;
  classifications?: string[];
  identifiers?: CompanyIdentifierInput[];
  confidence?: number;
  completeness?: number;
  source?: {
    url: string;
    type?: string;
    title?: string;
    evidence?: Record<string, unknown>;
    expiresAt?: Date | null;
  };
};

export type CompanyMatch = {
  companyId: string;
  tier: "official_identifier" | "domain" | "name_country" | "fuzzy_review";
  confidence: number;
  reviewRequired: boolean;
};

type MemoryCompany = CompanyInput & {
  id: string;
  normalizedName: string;
  normalizedDomain: string | null;
};
type MemoryCandidate = {
  id: string;
  fingerprint: string;
  input: CompanyInput;
  resolution: string;
  canonicalCompanyId: string | null;
  lastSeenAt: Date;
};
type MemoryCampaign = {
  id: string;
  projectId: string;
  agendaId: string | null;
  name: string;
  targetCount: number;
  existingCountPolicy: string;
  status: string;
  candidateIds: Set<string>;
  saturationReason: string | null;
};
type MemoryClaim = {
  campaignId: string;
  candidateId: string;
  leaseToken: string;
  leaseExpiresAt: Date;
  releasedAt: Date | null;
};

const globalResearch = globalThis as typeof globalThis & {
  __companyResearchMemory?: {
    companies: MemoryCompany[];
    candidates: MemoryCandidate[];
    campaigns: MemoryCampaign[];
    claims: MemoryClaim[];
  };
};
const memory = globalResearch.__companyResearchMemory ??= {
  companies: [],
  candidates: [],
  campaigns: [],
  claims: []
};

export function normalizeCompanyName(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|corporation|company|limited|inc|corp|co|ltd|llc|plc)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeDomain(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return value.toLowerCase().replace(/^www\./, "").split("/")[0].replace(/\.$/, "") || null;
  }
}

function normalizeIdentifier(identifier: CompanyIdentifierInput) {
  return {
    type: identifier.type.trim().toLowerCase(),
    value: identifier.value.trim().toUpperCase().replace(/\s+/g, ""),
    issuingCountry: identifier.issuingCountry?.trim().toUpperCase() || null
  };
}

function candidateFingerprint(input: CompanyInput) {
  const identity = [
    normalizeDomain(input.domain),
    normalizeCompanyName(input.legalName),
    input.countryCode?.toUpperCase() ?? "",
    ...(input.identifiers ?? []).map((item) => {
      const normalized = normalizeIdentifier(item);
      return `${normalized.type}:${normalized.value}`;
    }).sort()
  ].join("|");
  return createHash("sha256").update(identity).digest("hex");
}

function similarity(left: string, right: string) {
  const a = [...new Set(left.split(" ").filter(Boolean))];
  const b = [...new Set(right.split(" ").filter(Boolean))];
  if (a.length === 0 || b.length === 0) return 0;
  const overlap = a.filter((token) => b.some((other) =>
    token === other ||
    (Math.min(token.length, other.length) >= 5 &&
      (token.startsWith(other) || other.startsWith(token)))
  )).length;
  return overlap / Math.max(a.length, b.length);
}

export async function findCompanyMatches(input: CompanyInput): Promise<CompanyMatch[]> {
  const identifiers = (input.identifiers ?? []).map(normalizeIdentifier);
  const domain = normalizeDomain(input.domain);
  const name = normalizeCompanyName(input.legalName);
  const country = input.countryCode?.toUpperCase() ?? null;

  if (!db) {
    return memory.companies.flatMap((company): CompanyMatch[] => {
      const companyIdentifiers = (company.identifiers ?? []).map(normalizeIdentifier);
      if (identifiers.some((candidate) => companyIdentifiers.some(
        (known) => known.type === candidate.type && known.value === candidate.value
      ))) {
        return [{ companyId: company.id, tier: "official_identifier", confidence: 100, reviewRequired: false }];
      }
      if (domain && company.normalizedDomain === domain) {
        return [{ companyId: company.id, tier: "domain", confidence: 98, reviewRequired: false }];
      }
      if (company.normalizedName === name && (company.countryCode?.toUpperCase() ?? null) === country) {
        return [{ companyId: company.id, tier: "name_country", confidence: 92, reviewRequired: false }];
      }
      if (similarity(company.normalizedName, name) >= 0.75) {
        return [{ companyId: company.id, tier: "fuzzy_review", confidence: 70, reviewRequired: true }];
      }
      return [];
    });
  }

  if (identifiers.length > 0) {
    const identifierMatches = await db.select({ companyId: companyIdentifiers.companyId })
      .from(companyIdentifiers)
      .where(and(
        eq(companyIdentifiers.organizationId, MTI_ORGANIZATION_ID),
        or(...identifiers.map((item) => and(
          eq(companyIdentifiers.type, item.type),
          eq(companyIdentifiers.value, item.value)
        )))
      ));
    if (identifierMatches.length > 0) {
      return identifierMatches.map(({ companyId }) => ({
        companyId, tier: "official_identifier", confidence: 100, reviewRequired: false
      }));
    }
  }

  const exact = await db.select({
    id: canonicalCompanies.id,
    normalizedName: canonicalCompanies.normalizedName,
    countryCode: canonicalCompanies.countryCode,
    normalizedDomain: canonicalCompanies.normalizedDomain
  }).from(canonicalCompanies).where(and(
    eq(canonicalCompanies.organizationId, MTI_ORGANIZATION_ID),
    domain
      ? or(
          eq(canonicalCompanies.normalizedDomain, domain),
          and(eq(canonicalCompanies.normalizedName, name), country
            ? eq(canonicalCompanies.countryCode, country)
            : isNull(canonicalCompanies.countryCode))
        )
      : and(eq(canonicalCompanies.normalizedName, name), country
          ? eq(canonicalCompanies.countryCode, country)
          : isNull(canonicalCompanies.countryCode))
  ));
  if (exact.length > 0) {
    return exact.map((company) => company.normalizedDomain === domain && domain
      ? { companyId: company.id, tier: "domain", confidence: 98, reviewRequired: false }
      : { companyId: company.id, tier: "name_country", confidence: 92, reviewRequired: false });
  }

  const possible = await db.select({
    id: canonicalCompanies.id,
    normalizedName: canonicalCompanies.normalizedName
  }).from(canonicalCompanies).where(eq(canonicalCompanies.organizationId, MTI_ORGANIZATION_ID));
  return possible
    .filter((company) => similarity(company.normalizedName, name) >= 0.75)
    .map((company) => ({
      companyId: company.id,
      tier: "fuzzy_review" as const,
      confidence: 70,
      reviewRequired: true
    }));
}

export async function registerCompany(input: CompanyInput) {
  const match = (await findCompanyMatches(input))[0];
  if (match && !match.reviewRequired) return { companyId: match.companyId, created: false, match };
  if (match?.reviewRequired) return { companyId: null, created: false, match };

  const normalizedName = normalizeCompanyName(input.legalName);
  const normalizedDomain = normalizeDomain(input.domain);
  const countryCode = input.countryCode?.toUpperCase() ?? null;
  if (!db) {
    const company: MemoryCompany = {
      ...input, id: randomUUID(), normalizedName, normalizedDomain, countryCode
    };
    memory.companies.push(company);
    return { companyId: company.id, created: true, match: null };
  }
  return db.transaction(async (tx) => {
    const [company] = await tx.insert(canonicalCompanies).values({
      organizationId: MTI_ORGANIZATION_ID,
      legalName: input.legalName.trim(),
      tradingNames: input.tradingNames ?? [],
      normalizedName,
      normalizedDomain,
      countryCode,
      locations: input.locations ?? [],
      classifications: input.classifications ?? [],
      confidence: input.confidence ?? 0,
      completeness: input.completeness ?? 0,
      lastVerifiedAt: input.source ? new Date() : null
    }).returning({ id: canonicalCompanies.id });
    if ((input.identifiers ?? []).length > 0) {
      await tx.insert(companyIdentifiers).values((input.identifiers ?? []).map((item) => ({
        organizationId: MTI_ORGANIZATION_ID,
        companyId: company.id,
        ...normalizeIdentifier(item)
      })));
    }
    if (input.source) {
      await tx.insert(companySources).values({
        organizationId: MTI_ORGANIZATION_ID,
        companyId: company.id,
        sourceUrl: input.source.url,
        sourceType: input.source.type ?? "web",
        title: input.source.title ?? "",
        evidence: input.source.evidence ?? {},
        expiresAt: input.source.expiresAt ?? null
      });
    }
    return { companyId: company.id, created: true, match: null };
  });
}

export async function createResearchCampaign(input: {
  projectId: string;
  agendaId?: string | null;
  name: string;
  targetCount: number;
  scope?: Record<string, unknown>;
  qualificationRules?: string[];
  requiredFields?: string[];
  exclusions?: string[];
  sourcePlan?: string[];
  queryPlan?: string[];
  existingCountPolicy?: "ask" | "include" | "exclude";
}) {
  if (!db) {
    const campaign: MemoryCampaign = {
      id: randomUUID(),
      projectId: input.projectId,
      agendaId: input.agendaId ?? null,
      name: input.name,
      targetCount: input.targetCount,
      existingCountPolicy: input.existingCountPolicy ?? "ask",
      status: "draft",
      candidateIds: new Set(),
      saturationReason: null
    };
    memory.campaigns.push(campaign);
    return campaign;
  }
  const [campaign] = await db.insert(researchCampaigns).values({
    organizationId: MTI_ORGANIZATION_ID,
    projectId: input.projectId,
    agendaId: input.agendaId ?? null,
    name: input.name,
    targetCount: input.targetCount,
    scope: input.scope ?? {},
    qualificationRules: input.qualificationRules ?? [],
    requiredFields: input.requiredFields ?? [],
    exclusions: input.exclusions ?? [],
    sourcePlan: input.sourcePlan ?? [],
    queryPlan: input.queryPlan ?? [],
    existingCountPolicy: input.existingCountPolicy ?? "ask"
  }).returning();
  return campaign;
}

export async function addCampaignCandidate(campaignId: string, input: CompanyInput) {
  const fingerprint = candidateFingerprint(input);
  const matches = await findCompanyMatches(input);
  const best = matches[0] ?? null;
  const resolution = best
    ? best.reviewRequired ? "unresolved" : "reusable"
    : "new";

  if (!db) {
    let candidate = memory.candidates.find((item) => item.fingerprint === fingerprint);
    if (!candidate) {
      candidate = {
        id: randomUUID(), fingerprint, input, resolution,
        canonicalCompanyId: best?.companyId ?? null, lastSeenAt: new Date()
      };
      memory.candidates.push(candidate);
    } else {
      candidate.lastSeenAt = new Date();
    }
    const campaign = memory.campaigns.find((item) => item.id === campaignId);
    if (!campaign) throw new Error("Research campaign not found.");
    campaign.candidateIds.add(candidate.id);
    return { candidateId: candidate.id, resolution, reused: Boolean(best && !best.reviewRequired) };
  }

  return db.transaction(async (tx) => {
    const [candidate] = await tx.insert(companyCandidates).values({
      organizationId: MTI_ORGANIZATION_ID,
      fingerprint,
      proposedName: input.legalName,
      normalizedName: normalizeCompanyName(input.legalName),
      normalizedDomain: normalizeDomain(input.domain),
      countryCode: input.countryCode?.toUpperCase() ?? null,
      address: input.locations?.[0]?.address ?? null,
      canonicalCompanyId: best?.companyId ?? null,
      resolution,
      resolutionReason: best ? `Matched by ${best.tier}.` : null,
      evidence: input.source?.evidence ?? {}
    }).onConflictDoUpdate({
      target: [companyCandidates.organizationId, companyCandidates.fingerprint],
      set: { lastSeenAt: new Date(), updatedAt: new Date() }
    }).returning();
    await tx.insert(campaignCandidates).values({
      campaignId,
      candidateId: candidate.id,
      status: resolution
    }).onConflictDoNothing();
    return { candidateId: candidate.id, resolution, reused: Boolean(best && !best.reviewRequired) };
  });
}

export async function getCampaignCoverage(campaignId: string) {
  if (!db) {
    const campaign = memory.campaigns.find((item) => item.id === campaignId);
    if (!campaign) return null;
    const candidates = memory.candidates.filter((item) => campaign.candidateIds.has(item.id));
    const counts = Object.fromEntries(["new", "reusable", "stale", "incomplete", "rejected", "duplicate", "unresolved"]
      .map((status) => [status, candidates.filter((item) => item.resolution === status).length]));
    const eligible = counts.new + counts.reusable + counts.stale + counts.incomplete;
    return {
      campaignId,
      targetCount: campaign.targetCount,
      existingCountPolicy: campaign.existingCountPolicy,
      counts,
      eligible,
      remaining: Math.max(0, campaign.targetCount - eligible),
      saturated: campaign.status === "saturated",
      saturationReason: campaign.saturationReason
    };
  }
  const [campaign] = await db.select().from(researchCampaigns).where(and(
    eq(researchCampaigns.id, campaignId),
    eq(researchCampaigns.organizationId, MTI_ORGANIZATION_ID)
  )).limit(1);
  if (!campaign) return null;
  const linked = await db.select({ resolution: companyCandidates.resolution })
    .from(campaignCandidates)
    .innerJoin(companyCandidates, eq(companyCandidates.id, campaignCandidates.candidateId))
    .where(eq(campaignCandidates.campaignId, campaignId));
  const statuses = ["new", "reusable", "stale", "incomplete", "rejected", "duplicate", "unresolved"];
  const counts = Object.fromEntries(statuses.map(
    (status) => [status, linked.filter((item) => item.resolution === status).length]
  ));
  const eligible = counts.new + counts.reusable + counts.stale + counts.incomplete;
  return {
    campaignId,
    targetCount: campaign.targetCount,
    existingCountPolicy: campaign.existingCountPolicy,
    counts,
    eligible,
    remaining: Math.max(0, campaign.targetCount - eligible),
    saturated: campaign.status === "saturated",
    saturationReason: campaign.saturationReason
  };
}

export async function claimCandidate(input: {
  campaignId: string;
  candidateId: string;
  workerRunId?: string | null;
  leaseSeconds?: number;
}) {
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseSeconds ?? 300) * 1000);
  if (!db) {
    const existing = memory.claims.find((claim) =>
      claim.campaignId === input.campaignId && claim.candidateId === input.candidateId
    );
    if (existing && !existing.releasedAt && existing.leaseExpiresAt > now) return null;
    if (existing) Object.assign(existing, { leaseToken, leaseExpiresAt, releasedAt: null });
    else memory.claims.push({ ...input, leaseToken, leaseExpiresAt, releasedAt: null });
    return { leaseToken, leaseExpiresAt };
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.campaignId}:${input.candidateId}`}))`);
    const [existing] = await tx.select().from(companyResearchClaims).where(and(
      eq(companyResearchClaims.campaignId, input.campaignId),
      eq(companyResearchClaims.candidateId, input.candidateId)
    )).limit(1);
    if (existing && !existing.releasedAt && existing.leaseExpiresAt > now) return null;
    if (existing) {
      await tx.update(companyResearchClaims).set({
        workerRunId: input.workerRunId ?? null,
        leaseToken,
        leaseExpiresAt,
        releasedAt: null
      }).where(eq(companyResearchClaims.id, existing.id));
    } else {
      await tx.insert(companyResearchClaims).values({
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

export async function releaseCandidateClaim(
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
  const rows = await db.update(companyResearchClaims).set({ releasedAt: new Date() }).where(and(
    eq(companyResearchClaims.campaignId, campaignId),
    eq(companyResearchClaims.candidateId, candidateId),
    eq(companyResearchClaims.leaseToken, leaseToken)
  )).returning({ id: companyResearchClaims.id });
  return rows.length > 0;
}

export async function linkCompanyToProject(input: {
  companyId: string;
  projectId: string;
  agendaId?: string | null;
  disposition?: string;
}) {
  if (!db) return input;
  const [link] = await db.insert(companyProjectLinks).values({
    organizationId: MTI_ORGANIZATION_ID,
    companyId: input.companyId,
    projectId: input.projectId,
    agendaId: input.agendaId ?? null,
    disposition: input.disposition ?? "in_scope"
  }).onConflictDoNothing().returning();
  return link ?? input;
}

export async function markCampaignSaturated(campaignId: string, reason: string, estimatedRemaining = 0) {
  if (!db) {
    const campaign = memory.campaigns.find((item) => item.id === campaignId);
    if (!campaign) return null;
    campaign.status = "saturated";
    campaign.saturationReason = reason;
    return campaign;
  }
  const [campaign] = await db.update(researchCampaigns).set({
    status: "saturated",
    saturationReason: reason,
    estimatedRemaining,
    updatedAt: new Date()
  }).where(and(
    eq(researchCampaigns.id, campaignId),
    eq(researchCampaigns.organizationId, MTI_ORGANIZATION_ID)
  )).returning();
  return campaign ?? null;
}
