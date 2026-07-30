import { NextResponse } from "next/server";
import { z } from "zod";
import { analytics } from "@/lib/ai/usage";
import { guard } from "@/lib/api/guard";

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
  const data = await analytics({
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
