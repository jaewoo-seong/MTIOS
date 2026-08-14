import { and, desc, eq, gte } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/client";
import { mcpExternalCredentials, mcpExternalInvocations } from "@/lib/db/schema";

export async function externalMcpMetrics(organizationId: string, days = 30) {
  const db = requireDatabase();
  const from = new Date(Date.now() - Math.max(1, Math.min(90, days)) * 86_400_000);
  const rows = await db.select({
    invocation: mcpExternalInvocations,
    clientName: mcpExternalCredentials.clientName
  }).from(mcpExternalInvocations).innerJoin(
    mcpExternalCredentials,
    eq(mcpExternalCredentials.id, mcpExternalInvocations.credentialId)
  ).where(and(
    eq(mcpExternalInvocations.organizationId, organizationId),
    gte(mcpExternalInvocations.startedAt, from)
  )).orderBy(desc(mcpExternalInvocations.startedAt)).limit(10_000);

  const durations = rows.map(({ invocation }) => invocation.durationMs).sort((a, b) => a - b);
  const completed = rows.filter(({ invocation }) => invocation.status === "completed").length;
  const failures = rows.filter(({ invocation }) => invocation.status === "failed").length;
  const totals = {
    calls: rows.length,
    completed,
    failures,
    failureRate: rows.length ? failures / rows.length : 0,
    averageLatencyMs: rows.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / rows.length) : 0,
    p95LatencyMs: percentile(durations, 0.95),
    truncatedResponses: rows.filter(({ invocation }) => invocation.outputTruncated).length,
    modelCostMicros: rows.reduce((sum, { invocation }) => sum + invocation.modelCostMicros, 0)
  };
  return {
    from: from.toISOString(),
    to: new Date().toISOString(),
    capped: rows.length === 10_000,
    totals,
    byTool: group(rows.map(({ invocation }) => ({
      key: invocation.toolName,
      failed: invocation.status === "failed",
      durationMs: invocation.durationMs,
      modelCostMicros: invocation.modelCostMicros,
      truncated: invocation.outputTruncated
    }))),
    byClient: group(rows.map(({ invocation, clientName }) => ({
      key: clientName,
      failed: invocation.status === "failed",
      durationMs: invocation.durationMs,
      modelCostMicros: invocation.modelCostMicros,
      truncated: invocation.outputTruncated
    }))),
    recentFailures: rows.filter(({ invocation }) => invocation.status === "failed").slice(0, 50).map(({ invocation, clientName }) => ({
      id: invocation.id,
      clientName,
      toolName: invocation.toolName,
      errorCode: invocation.errorCode,
      durationMs: invocation.durationMs,
      startedAt: invocation.startedAt.toISOString()
    }))
  };
}

function group(rows: Array<{ key: string; failed: boolean; durationMs: number; modelCostMicros: number; truncated: boolean }>) {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) groups.set(row.key, [...(groups.get(row.key) ?? []), row]);
  return [...groups.entries()].map(([key, items]) => ({
    key,
    calls: items.length,
    failures: items.filter((item) => item.failed).length,
    averageLatencyMs: Math.round(items.reduce((sum, item) => sum + item.durationMs, 0) / items.length),
    p95LatencyMs: percentile(items.map((item) => item.durationMs).sort((a, b) => a - b), 0.95),
    truncatedResponses: items.filter((item) => item.truncated).length,
    modelCostMicros: items.reduce((sum, item) => sum + item.modelCostMicros, 0)
  })).sort((left, right) => right.calls - left.calls);
}

function percentile(sorted: number[], fraction: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}
