import { NextResponse } from "next/server";
import { z } from "zod";
import { analytics } from "@/lib/ai/usage";
import { guard } from "@/lib/api/guard";
import { isUiAuditMode } from "@/lib/ui-audit-mode";

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  provider: z.string().max(80).optional(),
  route: z.string().max(80).optional(),
  format: z.enum(["json", "csv"]).default("json")
});

export const GET = guard(async (request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });
  }
  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
  const from = parsed.data.from
    ? new Date(parsed.data.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (from >= to) return NextResponse.json({ error: "invalid_date_range" }, { status: 400 });
  const data = isUiAuditMode() ? auditAnalytics(from, to) : await analytics({
    from,
    to,
    projectId: parsed.data.projectId,
    userId: parsed.data.userId,
    provider: parsed.data.provider,
    route: parsed.data.route
  });
  if (parsed.data.format === "csv") {
    const header = [
      "project", "user", "agent_type", "route", "provider", "model",
      "requests", "successes", "failures", "fallbacks", "retries",
      "input_tokens", "output_tokens", "average_latency_ms", "estimated_cost_usd"
    ];
    const lines = data.rows.map((row) => [
      row.projectName ?? "",
      row.userName ?? "",
      row.agentType ?? "",
      row.route,
      row.provider ?? "",
      row.model ?? "",
      row.requests,
      row.successes,
      row.failures,
      row.fallbacks,
      row.retries,
      row.inputTokens,
      row.outputTokens,
      row.averageLatencyMs,
      (Number(row.costMicros) / 1_000_000).toFixed(6)
    ].map(csvCell).join(","));
    return new NextResponse([header.join(","), ...lines].join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ai-analytics-${from.toISOString().slice(0, 10)}.csv"`
      }
    });
  }
  return NextResponse.json({ data });
}, { admin: true });

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function auditAnalytics(from: Date, to: Date) {
  const rows = [
    {
      projectId: "10000000-0000-4000-8000-000000000001",
      projectName: "Korea Advanced Manufacturing Client Research",
      userId: "00000000-0000-4000-8000-0000000000a1",
      userName: "UI Audit Operator",
      agentType: "company_researcher",
      route: "research/free",
      provider: "openrouter",
      model: "qwen/qwen3-235b-a22b:free",
      requests: 18,
      successes: 17,
      failures: 1,
      fallbacks: 2,
      retries: 3,
      inputTokens: 124800,
      outputTokens: 36100,
      costMicros: 0,
      averageLatencyMs: 2840
    },
    {
      projectId: "10000000-0000-4000-8000-000000000001",
      projectName: "Korea Advanced Manufacturing Client Research",
      userId: "00000000-0000-4000-8000-0000000000a1",
      userName: "UI Audit Operator",
      agentType: "dossier_writer",
      route: "writing/free",
      provider: "openrouter",
      model: "deepseek/deepseek-r1-0528:free",
      requests: 6,
      successes: 6,
      failures: 0,
      fallbacks: 0,
      retries: 0,
      inputTokens: 68400,
      outputTokens: 22700,
      costMicros: 0,
      averageLatencyMs: 4980
    }
  ];
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    rows,
    totals: rows.reduce((total, row) => ({
      requests: total.requests + row.requests,
      successes: total.successes + row.successes,
      failures: total.failures + row.failures,
      fallbacks: total.fallbacks + row.fallbacks,
      retries: total.retries + row.retries,
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      costMicros: total.costMicros + row.costMicros
    }), { requests: 0, successes: 0, failures: 0, fallbacks: 0, retries: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 }),
    quotas: [
      {
        id: "audit-openrouter-quota",
        provider: "openrouter",
        route: "*",
        period: "daily",
        allowance: 1000,
        timezone: "America/Indiana/Indianapolis",
        active: true,
        state: { used: 24, remaining: 976, resetAt: new Date(to.getTime() + 86_400_000).toISOString() }
      },
      {
        id: "audit-tavily-quota",
        provider: "tavily",
        route: "*",
        period: "monthly",
        allowance: 1000,
        timezone: "America/Indiana/Indianapolis",
        active: true,
        state: { used: 41, remaining: 959, resetAt: new Date(to.getTime() + 30 * 86_400_000).toISOString() }
      }
    ],
    approvals: [],
    providerUsage: [
      { provider: "openrouter", route: "research/free", source: "observed", requests: 18 },
      { provider: "openrouter", route: "writing/free", source: "observed", requests: 6 },
      { provider: "tavily", route: "web_search", source: "observed", requests: 41 }
    ],
    providerReported: { tavily: { configured: false, available: false as const } }
  };
}
