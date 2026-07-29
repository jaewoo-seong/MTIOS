import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  brainstormingIdeas,
  brainstormingSessions,
  brandProfiles,
  contentCalendarItems,
  externalActionProposals,
  marketingCampaigns,
  marketingConcepts,
  marketingExperiments,
  marketingVariants,
  reviews
} from "@/lib/db/schema";
import { MTI_ORGANIZATION_ID, repository } from "@/lib/repository";

type Stored = Record<string, unknown> & { id: string; createdAt: string; updatedAt: string };
const globalCreative = globalThis as typeof globalThis & {
  __creativeWorkMemory?: {
    brands: Stored[];
    campaigns: Stored[];
    concepts: Stored[];
    variants: Stored[];
    sessions: Stored[];
    ideas: Stored[];
    experiments: Stored[];
    proposals: Stored[];
    reviews: Stored[];
  };
};
const memory = globalCreative.__creativeWorkMemory ??= {
  brands: [], campaigns: [], concepts: [], variants: [], sessions: [],
  ideas: [], experiments: [], proposals: [], reviews: []
};
const timestamped = (input: Record<string, unknown>): Stored => ({
  id: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...input
});

export async function createBrandProfile(input: {
  projectId?: string | null;
  name: string;
  audience?: Array<Record<string, unknown>>;
  positioning?: string;
  voice?: Record<string, unknown>;
  approvedClaims?: string[];
  prohibitedClaims?: string[];
  competitors?: string[];
}) {
  if (!db) {
    const row = timestamped({ ...input, projectId: input.projectId ?? null, status: "draft", revision: 1 });
    memory.brands.push(row);
    return row;
  }
  const [row] = await db.insert(brandProfiles).values({
    organizationId: MTI_ORGANIZATION_ID,
    projectId: input.projectId ?? null,
    name: input.name,
    audience: input.audience ?? [],
    positioning: input.positioning ?? "",
    voice: input.voice ?? {},
    approvedClaims: input.approvedClaims ?? [],
    prohibitedClaims: input.prohibitedClaims ?? [],
    competitors: input.competitors ?? []
  }).returning();
  return row;
}

export async function setBrandProfileStatus(id: string, status: "draft" | "approved" | "retired") {
  if (!db) {
    const row = memory.brands.find((item) => item.id === id);
    if (!row) return null;
    row.status = status;
    row.updatedAt = new Date().toISOString();
    return row;
  }
  const [row] = await db.update(brandProfiles).set({
    status,
    updatedAt: new Date()
  }).where(and(
    eq(brandProfiles.id, id),
    eq(brandProfiles.organizationId, MTI_ORGANIZATION_ID)
  )).returning();
  return row ?? null;
}

export async function createMarketingCampaign(input: {
  projectId: string;
  agendaId?: string | null;
  brandProfileId?: string | null;
  name: string;
  objective: string;
  audiences?: Array<Record<string, unknown>>;
  positioning?: string[];
  channels?: string[];
  formats?: string[];
  assumptions?: string[];
  successMetrics?: Array<Record<string, unknown>>;
}) {
  if (!db) {
    const row = timestamped({
      ...input,
      agendaId: input.agendaId ?? null,
      brandProfileId: input.brandProfileId ?? null,
      status: "draft",
      approvalState: "working"
    });
    memory.campaigns.push(row);
    return row;
  }
  const [row] = await db.insert(marketingCampaigns).values({
    organizationId: MTI_ORGANIZATION_ID,
    projectId: input.projectId,
    agendaId: input.agendaId ?? null,
    brandProfileId: input.brandProfileId ?? null,
    name: input.name,
    objective: input.objective,
    audiences: input.audiences ?? [],
    positioning: input.positioning ?? [],
    channels: input.channels ?? [],
    formats: input.formats ?? [],
    assumptions: input.assumptions ?? [],
    successMetrics: input.successMetrics ?? []
  }).returning();
  return row;
}

export async function setMarketingCampaignApproval(
  id: string,
  approvalState: "working" | "approved" | "rejected",
  status?: string
) {
  if (!db) {
    const row = memory.campaigns.find((item) => item.id === id);
    if (!row) return null;
    Object.assign(row, { approvalState, status: status ?? row.status, updatedAt: new Date().toISOString() });
    return row;
  }
  const [row] = await db.update(marketingCampaigns).set({
    approvalState,
    ...(status ? { status } : {}),
    updatedAt: new Date()
  }).where(and(
    eq(marketingCampaigns.id, id),
    eq(marketingCampaigns.organizationId, MTI_ORGANIZATION_ID)
  )).returning();
  return row ?? null;
}

export async function addMarketingConcept(campaignId: string, input: {
  title: string;
  rationale?: string;
  content?: Record<string, unknown>;
  position?: number;
}) {
  if (!db) {
    const row = timestamped({ campaignId, ...input, status: "proposed", decisionReason: null });
    memory.concepts.push(row);
    return row;
  }
  const [ownedCampaign] = await db.select({ id: marketingCampaigns.id })
    .from(marketingCampaigns)
    .where(and(
      eq(marketingCampaigns.id, campaignId),
      eq(marketingCampaigns.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
  if (!ownedCampaign) throw new Error("Marketing campaign not found.");
  const [row] = await db.insert(marketingConcepts).values({
    campaignId,
    title: input.title,
    rationale: input.rationale ?? "",
    content: input.content ?? {},
    position: input.position ?? 0
  }).returning();
  return row;
}

export async function decideMarketingConcept(
  id: string,
  status: "shortlisted" | "approved" | "rejected",
  decisionReason: string
) {
  if (!db) {
    const row = memory.concepts.find((item) => item.id === id);
    if (!row) return null;
    Object.assign(row, { status, decisionReason, updatedAt: new Date().toISOString() });
    return row;
  }
  const [owned] = await db.select({ id: marketingConcepts.id })
    .from(marketingConcepts)
    .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingConcepts.campaignId))
    .where(and(
      eq(marketingConcepts.id, id),
      eq(marketingCampaigns.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
  if (!owned) return null;
  const [row] = await db.update(marketingConcepts).set({
    status, decisionReason, updatedAt: new Date()
  }).where(eq(marketingConcepts.id, id)).returning();
  return row ?? null;
}

export async function addMarketingVariant(conceptId: string, input: {
  name: string;
  channel: string;
  format: string;
  content?: string;
}) {
  if (!db) {
    const row = timestamped({ conceptId, ...input, content: input.content ?? "", status: "draft" });
    memory.variants.push(row);
    return row;
  }
  const [owned] = await db.select({ id: marketingConcepts.id })
    .from(marketingConcepts)
    .innerJoin(marketingCampaigns, eq(marketingCampaigns.id, marketingConcepts.campaignId))
    .where(and(
      eq(marketingConcepts.id, conceptId),
      eq(marketingCampaigns.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
  if (!owned) throw new Error("Marketing concept not found.");
  const [row] = await db.insert(marketingVariants).values({ conceptId, ...input }).returning();
  return row;
}

export async function addContentCalendarItem(campaignId: string, input: {
  variantId?: string | null;
  title: string;
  channel: string;
  scheduledFor?: Date | null;
}) {
  if (!db) return timestamped({
    campaignId,
    ...input,
    variantId: input.variantId ?? null,
    scheduledFor: input.scheduledFor?.toISOString() ?? null,
    status: "planned"
  });
  const [ownedCampaign] = await db.select({ id: marketingCampaigns.id })
    .from(marketingCampaigns)
    .where(and(
      eq(marketingCampaigns.id, campaignId),
      eq(marketingCampaigns.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
  if (!ownedCampaign) throw new Error("Marketing campaign not found.");
  const [row] = await db.insert(contentCalendarItems).values({
    campaignId,
    variantId: input.variantId ?? null,
    title: input.title,
    channel: input.channel,
    scheduledFor: input.scheduledFor ?? null
  }).returning();
  return row;
}

export async function createBrainstormingSession(input: {
  projectId: string;
  agendaId?: string | null;
  prompt: string;
  evaluationCriteria?: string[];
  assumptions?: string[];
}) {
  if (!db) {
    const row = timestamped({
      ...input,
      agendaId: input.agendaId ?? null,
      status: "active",
      decisionSummary: ""
    });
    memory.sessions.push(row);
    return row;
  }
  const [row] = await db.insert(brainstormingSessions).values({
    organizationId: MTI_ORGANIZATION_ID,
    projectId: input.projectId,
    agendaId: input.agendaId ?? null,
    prompt: input.prompt,
    evaluationCriteria: input.evaluationCriteria ?? [],
    assumptions: input.assumptions ?? []
  }).returning();
  return row;
}

export async function addBrainstormingIdea(sessionId: string, input: {
  title: string;
  description?: string;
  scores?: Record<string, number>;
  position?: number;
}) {
  if (!db) {
    const row = timestamped({
      sessionId,
      ...input,
      description: input.description ?? "",
      scores: input.scores ?? {},
      status: "candidate",
      decisionReason: null
    });
    memory.ideas.push(row);
    return row;
  }
  const [ownedSession] = await db.select({ id: brainstormingSessions.id })
    .from(brainstormingSessions)
    .where(and(
      eq(brainstormingSessions.id, sessionId),
      eq(brainstormingSessions.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
  if (!ownedSession) throw new Error("Brainstorming session not found.");
  const [row] = await db.insert(brainstormingIdeas).values({
    sessionId,
    title: input.title,
    description: input.description ?? "",
    scores: input.scores ?? {},
    position: input.position ?? 0
  }).returning();
  return row;
}

export async function decideBrainstormingIdea(
  id: string,
  status: "shortlisted" | "selected" | "rejected",
  decisionReason: string
) {
  if (!db) {
    const row = memory.ideas.find((item) => item.id === id);
    if (!row) return null;
    Object.assign(row, { status, decisionReason, updatedAt: new Date().toISOString() });
    return row;
  }
  const [owned] = await db.select({ id: brainstormingIdeas.id })
    .from(brainstormingIdeas)
    .innerJoin(brainstormingSessions, eq(brainstormingSessions.id, brainstormingIdeas.sessionId))
    .where(and(
      eq(brainstormingIdeas.id, id),
      eq(brainstormingSessions.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
  if (!owned) return null;
  const [row] = await db.update(brainstormingIdeas).set({
    status, decisionReason, updatedAt: new Date()
  }).where(eq(brainstormingIdeas.id, id)).returning();
  return row ?? null;
}

export async function completeBrainstormingSession(id: string, decisionSummary: string) {
  if (!db) {
    const row = memory.sessions.find((item) => item.id === id);
    if (!row) return null;
    Object.assign(row, { status: "completed", decisionSummary, updatedAt: new Date().toISOString() });
    return row;
  }
  const [row] = await db.update(brainstormingSessions).set({
    status: "completed", decisionSummary, updatedAt: new Date()
  }).where(and(
    eq(brainstormingSessions.id, id),
    eq(brainstormingSessions.organizationId, MTI_ORGANIZATION_ID)
  )).returning();
  return row ?? null;
}

export async function createMarketingExperiment(input: {
  projectId: string;
  campaignId?: string | null;
  sessionId?: string | null;
  hypothesis: string;
  method: string;
  metrics?: string[];
}) {
  if (!db) {
    const row = timestamped({ ...input, status: "planned", result: {}, decision: null });
    memory.experiments.push(row);
    return row;
  }
  const [row] = await db.insert(marketingExperiments).values({
    organizationId: MTI_ORGANIZATION_ID,
    ...input,
    campaignId: input.campaignId ?? null,
    sessionId: input.sessionId ?? null,
    metrics: input.metrics ?? []
  }).returning();
  return row;
}

export async function proposeExternalMarketingAction(input: {
  projectId: string;
  campaignId?: string | null;
  actionType: "publish" | "send" | "activate_ad";
  payload: Record<string, unknown>;
  reason: string;
}) {
  if (!db) {
    const review = timestamped({
      projectId: input.projectId,
      subjectType: "external_marketing_action",
      status: "pending",
      reason: input.reason
    });
    memory.reviews.push(review);
    const proposal = timestamped({
      ...input,
      campaignId: input.campaignId ?? null,
      status: "review_required",
      reviewId: review.id,
      executedAt: null
    });
    review.subjectId = proposal.id;
    memory.proposals.push(proposal);
    return proposal;
  }
  return db.transaction(async (tx) => {
    const proposalId = crypto.randomUUID();
    const [review] = await tx.insert(reviews).values({
      organizationId: MTI_ORGANIZATION_ID,
      projectId: input.projectId,
      subjectType: "external_marketing_action",
      subjectId: proposalId,
      reason: input.reason
    }).returning({ id: reviews.id });
    const [proposal] = await tx.insert(externalActionProposals).values({
      id: proposalId,
      organizationId: MTI_ORGANIZATION_ID,
      projectId: input.projectId,
      campaignId: input.campaignId ?? null,
      actionType: input.actionType,
      payload: input.payload,
      reviewId: review.id
    }).returning();
    return proposal;
  });
}

export async function createCreativeOutput(input: {
  projectId: string;
  agendaId?: string | null;
  title: string;
  outputType:
    | "brief"
    | "campaign_plan"
    | "calendar"
    | "copy"
    | "creative_concept"
    | "decision_memo"
    | "experiment_plan";
  summary?: string;
  content?: string;
}) {
  const report = await repository.createReport({
    projectId: input.projectId,
    title: input.title,
    summary: input.summary ?? "",
    content: input.content ?? ""
  });
  let deliverable = null;
  if (input.agendaId) {
    deliverable = await repository.createDeliverable(input.projectId, {
      agendaId: input.agendaId,
      title: input.title,
      type: input.outputType,
      reviewRequired: true
    });
  }
  return { report, deliverable, editable: true };
}

export async function listApprovedCreativeContext(projectId: string) {
  if (!db) {
    const brands = memory.brands.filter((item) =>
      item.status === "approved" && (!item.projectId || item.projectId === projectId)
    );
    const campaigns = memory.campaigns.filter((item) =>
      item.projectId === projectId && item.approvalState === "approved"
    );
    return { brands, campaigns };
  }
  const [brands, campaigns] = await Promise.all([
    db.select().from(brandProfiles).where(and(
      eq(brandProfiles.organizationId, MTI_ORGANIZATION_ID),
      eq(brandProfiles.status, "approved"),
      or(eq(brandProfiles.projectId, projectId), isNull(brandProfiles.projectId))
    )),
    db.select().from(marketingCampaigns).where(and(
      eq(marketingCampaigns.organizationId, MTI_ORGANIZATION_ID),
      eq(marketingCampaigns.projectId, projectId),
      eq(marketingCampaigns.approvalState, "approved")
    ))
  ]);
  return { brands, campaigns };
}
