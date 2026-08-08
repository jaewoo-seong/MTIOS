import { randomBytes } from "node:crypto";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
  sql
} from "drizzle-orm";
import { db, requireDatabase } from "@/lib/db/client";
import {
  commands,
  modelCalls,
  premiumModelApprovals,
  projects,
  providerQuotaPolicies,
  providerUsageEvents,
  runs,
  users,
  workflowStates
} from "@/lib/db/schema";
import type { ModelCandidate } from "@/lib/ai/model-policy";
import type { ModelRoute } from "@/lib/ai/litellm";
import { MTI_ORGANIZATION_ID, repository } from "@/lib/repository";

export type QuotaState = {
  policyId: string;
  provider: string;
  route: string | null;
  period: string;
  allowance: number;
  used: number;
  remaining: number;
  resetAt: string;
  source: "observed" | "provider_reported" | "estimated";
};

export async function evaluateFreeRoute(
  route: ModelRoute,
  candidates: readonly ModelCandidate[]
) {
  const freeProviders = [...new Set(candidates
    .filter((candidate) => candidate.pricingClass === "free")
    .map((candidate) => candidate.provider))];
  if (freeProviders.length === 0) return { available: true, quotas: [] as QuotaState[] };
  const database = requireDatabase();
  const policies = await database.select().from(providerQuotaPolicies).where(and(
    eq(providerQuotaPolicies.organizationId, MTI_ORGANIZATION_ID),
    eq(providerQuotaPolicies.active, true),
    inArray(providerQuotaPolicies.provider, freeProviders),
    or(eq(providerQuotaPolicies.route, "*"), eq(providerQuotaPolicies.route, route))
  ));
  const quotas = await Promise.all(policies.map(quotaState));
  const available = freeProviders.some((provider) => {
    const providerQuotas = quotas.filter((quota) => quota.provider === provider);
    return providerQuotas.length === 0 || providerQuotas.every((quota) => quota.remaining > 0);
  });
  return { available, quotas };
}

export async function recordProviderUsage(input: {
  runId: string | null;
  modelCallId: string | null;
  provider: string;
  model: string | null;
  route: string;
  projectId: string | null;
  userId: string | null;
  source?: "observed" | "provider_reported" | "estimated";
}) {
  const database = requireDatabase();
  await database.insert(providerUsageEvents).values({
    organizationId: MTI_ORGANIZATION_ID,
    ...input,
    source: input.source ?? "observed"
  });
}

export async function providerQuotaAvailable(provider: string, route: string) {
  if (!db) return { available: true, quotas: [] as QuotaState[] };
  const database = requireDatabase();
  const policies = await database.select().from(providerQuotaPolicies).where(and(
    eq(providerQuotaPolicies.organizationId, MTI_ORGANIZATION_ID),
    eq(providerQuotaPolicies.active, true),
    eq(providerQuotaPolicies.provider, provider),
    or(eq(providerQuotaPolicies.route, "*"), eq(providerQuotaPolicies.route, route))
  ));
  if (policies.length === 0) return { available: true, quotas: [] as QuotaState[] };
  const quotas = await Promise.all(policies.map(quotaState));
  return { available: quotas.every((quota) => quota.remaining > 0), quotas };
}

export async function recordExternalProviderUsage(input: {
  provider: string;
  route: string;
  projectId: string | null;
  runId: string | null;
}) {
  if (!db) return;
  const database = requireDatabase();
  await database.insert(providerUsageEvents).values({
    organizationId: MTI_ORGANIZATION_ID,
    provider: input.provider,
    route: input.route,
    projectId: input.projectId,
    runId: input.runId,
    source: "observed"
  });
}

export async function createPremiumApproval(input: {
  runId: string;
  route: ModelRoute;
  maximumCostMicros: number;
  reason: string;
}) {
  const database = requireDatabase();
  const [scope] = await database.select({
    projectId: commands.projectId,
    userId: commands.createdBy,
    commandId: commands.id
  }).from(runs).innerJoin(commands, eq(commands.id, runs.commandId))
    .where(eq(runs.id, input.runId)).limit(1);
  if (!scope) throw new Error("Run not found.");
  const [existing] = await database.select().from(premiumModelApprovals).where(and(
    eq(premiumModelApprovals.runId, input.runId),
    eq(premiumModelApprovals.route, input.route)
  )).limit(1);
  if (existing) return existing;
  const [approval] = await database.insert(premiumModelApprovals).values({
    organizationId: MTI_ORGANIZATION_ID,
    projectId: scope.projectId,
    runId: input.runId,
    route: input.route ?? "*",
    proposedProvider: "openrouter",
    proposedModel: process.env.PREMIUM_FALLBACK_MODEL ?? process.env.EXECUTIVE_MODEL ?? "not_configured",
    maximumCostMicros: input.maximumCostMicros,
    reason: input.reason,
    requestedBy: scope.userId,
    resumeToken: randomBytes(24).toString("base64url")
  }).returning();
  await repository.updateRun(input.runId, { status: "review_required" });
  await repository.updateCommand(scope.commandId, { status: "review_required" });
  await repository.appendEvent(input.runId, {
    type: "run.premium_approval_required",
    message: "Free model routes are unavailable. Administrator approval is required for premium fallback."
  });
  await database.insert(workflowStates).values({
    runId: input.runId,
    status: "review_required",
    checkpoint: { phase: "premium_approval", approvalId: approval.id }
  }).onConflictDoUpdate({
    target: workflowStates.runId,
    set: {
      status: "review_required",
      checkpoint: { phase: "premium_approval", approvalId: approval.id },
      updatedAt: new Date()
    }
  });
  return approval;
}

export async function approvedPremiumFallback(runId: string, route: ModelRoute) {
  const database = requireDatabase();
  const [approval] = await database.select().from(premiumModelApprovals).where(and(
    eq(premiumModelApprovals.runId, runId),
    eq(premiumModelApprovals.route, route),
    eq(premiumModelApprovals.status, "approved")
  )).limit(1);
  return approval ?? null;
}

export async function listQuotaPolicies() {
  const database = requireDatabase();
  const policies = await database.select().from(providerQuotaPolicies).where(
    eq(providerQuotaPolicies.organizationId, MTI_ORGANIZATION_ID)
  ).orderBy(providerQuotaPolicies.provider, providerQuotaPolicies.route);
  return Promise.all(policies.map(async (policy) => ({
    ...policy,
    state: await quotaState(policy)
  })));
}

/** Installs the product defaults idempotently; administrators can edit them afterwards. */
export async function ensureDefaultQuotaPolicies() {
  const database = requireDatabase();
  await database.insert(providerQuotaPolicies).values([
    { organizationId: MTI_ORGANIZATION_ID, provider: "openrouter", route: "*", period: "daily", allowance: 1000, timezone: "America/Indiana/Indianapolis" },
    { organizationId: MTI_ORGANIZATION_ID, provider: "tavily", route: "*", period: "monthly", allowance: 1000, timezone: "America/Indiana/Indianapolis" }
  ]).onConflictDoNothing();
}

export async function tavilyReportedUsage() {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return { configured: false, available: false as const };
  try {
    const response = await fetch("https://api.tavily.com/usage", {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(4000), cache: "no-store"
    });
    if (!response.ok) return { configured: true, available: false as const };
    return { configured: true, available: true as const, data: await response.json() };
  } catch { return { configured: true, available: false as const }; }
}

export async function createQuotaPolicy(input: {
  provider: string;
  route: string | null;
  period: "daily" | "monthly";
  allowance: number;
  timezone: string;
  actorId: string;
}) {
  const database = requireDatabase();
  const [row] = await database.insert(providerQuotaPolicies).values({
    organizationId: MTI_ORGANIZATION_ID,
    provider: input.provider,
    route: input.route ?? "*",
    period: input.period,
    allowance: input.allowance,
    timezone: input.timezone,
    createdBy: input.actorId
  }).onConflictDoUpdate({
    target: [
      providerQuotaPolicies.organizationId,
      providerQuotaPolicies.provider,
      providerQuotaPolicies.route,
      providerQuotaPolicies.period
    ],
    set: {
      allowance: input.allowance,
      timezone: input.timezone,
      active: true,
      updatedAt: new Date()
    }
  }).returning();
  return row;
}

export async function updateQuotaPolicy(id: string, input: {
  allowance?: number;
  timezone?: string;
  active?: boolean;
}) {
  const database = requireDatabase();
  const [row] = await database.update(providerQuotaPolicies).set({
    ...input,
    updatedAt: new Date()
  }).where(and(
    eq(providerQuotaPolicies.id, id),
    eq(providerQuotaPolicies.organizationId, MTI_ORGANIZATION_ID)
  )).returning();
  if (!row) throw new Error("Quota policy not found.");
  return row;
}

export async function analytics(input: {
  from: Date;
  to: Date;
  projectId?: string | null;
  userId?: string | null;
  provider?: string | null;
  route?: string | null;
}) {
  const database = requireDatabase();
  await ensureDefaultQuotaPolicies();
  const conditions = [
    gte(modelCalls.createdAt, input.from),
    lte(modelCalls.createdAt, input.to),
    input.projectId ? eq(modelCalls.projectId, input.projectId) : undefined,
    input.userId ? eq(modelCalls.userId, input.userId) : undefined,
    input.provider ? eq(modelCalls.provider, input.provider) : undefined,
    input.route ? eq(modelCalls.route, input.route) : undefined
  ].filter(Boolean) as Parameters<typeof and>;
  const rows = await database.select({
    projectId: modelCalls.projectId,
    projectName: projects.name,
    userId: modelCalls.userId,
    userName: users.name,
    agentType: modelCalls.agentType,
    route: modelCalls.route,
    provider: modelCalls.provider,
    model: modelCalls.model,
    requests: sql<number>`count(*)::int`,
    successes: sql<number>`count(*) filter (where ${modelCalls.error} is null)::int`,
    failures: sql<number>`count(*) filter (where ${modelCalls.error} is not null)::int`,
    fallbacks: sql<number>`count(*) filter (where ${modelCalls.fallbackReason} is not null)::int`,
    retries: sql<number>`coalesce(sum(greatest(${modelCalls.attemptCount} - 1, 0)), 0)::int`,
    inputTokens: sql<number>`coalesce(sum(${modelCalls.inputTokens}), 0)::int`,
    outputTokens: sql<number>`coalesce(sum(${modelCalls.outputTokens}), 0)::int`,
    costMicros: sql<number>`coalesce(sum(${modelCalls.costMicros}), 0)::bigint`,
    averageLatencyMs: sql<number>`coalesce(avg(${modelCalls.latencyMs}), 0)::int`
  }).from(modelCalls)
    .leftJoin(projects, eq(projects.id, modelCalls.projectId))
    .leftJoin(users, eq(users.id, modelCalls.userId))
    .where(and(...conditions))
    .groupBy(
      modelCalls.projectId, projects.name, modelCalls.userId, users.name,
      modelCalls.agentType, modelCalls.route, modelCalls.provider, modelCalls.model
    )
    .orderBy(desc(sql`count(*)`));
  const approvals = await database.select().from(premiumModelApprovals).where(and(
    gte(premiumModelApprovals.createdAt, input.from),
    lte(premiumModelApprovals.createdAt, input.to)
  ));
  const providerUsage = await database.select({
    provider: providerUsageEvents.provider,
    route: providerUsageEvents.route,
    source: providerUsageEvents.source,
    requests: sql<number>`coalesce(sum(${providerUsageEvents.quantity}), 0)::int`
  }).from(providerUsageEvents).where(and(
    gte(providerUsageEvents.occurredAt, input.from),
    lte(providerUsageEvents.occurredAt, input.to),
    input.projectId ? eq(providerUsageEvents.projectId, input.projectId) : undefined,
    input.userId ? eq(providerUsageEvents.userId, input.userId) : undefined,
    input.provider ? eq(providerUsageEvents.provider, input.provider) : undefined,
    input.route ? eq(providerUsageEvents.route, input.route) : undefined
  )).groupBy(
    providerUsageEvents.provider,
    providerUsageEvents.route,
    providerUsageEvents.source
  ).orderBy(desc(sql`sum(${providerUsageEvents.quantity})`));
  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    rows,
    quotas: await listQuotaPolicies(),
    providerUsage,
    providerReported: { tavily: await tavilyReportedUsage() },
    approvals,
    totals: rows.reduce((total, row) => ({
      requests: total.requests + row.requests,
      successes: total.successes + row.successes,
      failures: total.failures + row.failures,
      fallbacks: total.fallbacks + row.fallbacks,
      retries: total.retries + row.retries,
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      costMicros: total.costMicros + Number(row.costMicros)
    }), {
      requests: 0, successes: 0, failures: 0, fallbacks: 0, retries: 0,
      inputTokens: 0, outputTokens: 0, costMicros: 0
    })
  };
}

async function quotaState(policy: typeof providerQuotaPolicies.$inferSelect): Promise<QuotaState> {
  const database = requireDatabase();
  const { start, end } = quotaWindow(policy.period, policy.timezone, new Date());
  const [result] = await database.select({
    used: sql<number>`coalesce(sum(${providerUsageEvents.quantity}), 0)::int`
  }).from(providerUsageEvents).where(and(
    eq(providerUsageEvents.organizationId, MTI_ORGANIZATION_ID),
    eq(providerUsageEvents.provider, policy.provider),
    policy.route !== "*" ? eq(providerUsageEvents.route, policy.route) : undefined,
    gte(providerUsageEvents.occurredAt, start),
    lte(providerUsageEvents.occurredAt, end)
  ));
  const used = result?.used ?? 0;
  return {
    policyId: policy.id,
    provider: policy.provider,
    route: policy.route,
    period: policy.period,
    allowance: policy.allowance,
    used,
    remaining: Math.max(0, policy.allowance - used),
    resetAt: end.toISOString(),
    source: "observed"
  };
}

export function quotaWindow(period: string, timezone: string, now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now).filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
  const year = parts.year;
  const month = parts.month;
  const day = period === "monthly" ? 1 : parts.day;
  const localStartAsUtc = new Date(Date.UTC(year, month - 1, day));
  const offset = timezoneOffset(localStartAsUtc, timezone);
  const start = new Date(localStartAsUtc.getTime() - offset);
  const nextLocal = period === "monthly"
    ? new Date(Date.UTC(year, month, 1))
    : new Date(Date.UTC(year, month - 1, day + 1));
  const nextOffset = timezoneOffset(nextLocal, timezone);
  return { start, end: new Date(nextLocal.getTime() - nextOffset - 1) };
}

function timezoneOffset(date: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    date.getTime();
}
