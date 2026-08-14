import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { externalMcpMetrics } from "@/lib/mcp/external-metrics";

const querySchema = z.coerce.number().int().min(1).max(90).default(30);

export const GET = guard(async (request, { session }) => {
  const parsed = querySchema.safeParse(new URL(request.url).searchParams.get("days") ?? undefined);
  if (!parsed.success) return NextResponse.json({ error: "invalid_days" }, { status: 400 });
  return NextResponse.json({ data: await externalMcpMetrics(session.organizationId, parsed.data) });
}, { admin: true });
