import { NextResponse } from "next/server";
import { z } from "zod";
import { createMarketingExperiment } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

const schema = z.object({
  projectId: z.string().uuid(),
  campaignId: z.string().uuid().nullable().optional(),
  sessionId: z.string().uuid().nullable().optional(),
  hypothesis: z.string().trim().min(2).max(10000),
  method: z.string().trim().min(2).max(10000),
  metrics: z.array(z.string().trim().min(1).max(500)).max(100).default([])
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await createMarketingExperiment(parsed.data)
  }, { status: 201 });
}
