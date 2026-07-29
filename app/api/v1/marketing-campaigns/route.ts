import { NextResponse } from "next/server";
import { z } from "zod";
import { createMarketingCampaign } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

const schema = z.object({
  projectId: z.string().uuid(),
  agendaId: z.string().uuid().nullable().optional(),
  brandProfileId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(200),
  objective: z.string().trim().min(2).max(10000),
  audiences: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
  positioning: z.array(z.string().trim().min(1).max(2000)).max(100).default([]),
  channels: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  formats: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  assumptions: z.array(z.string().trim().min(1).max(2000)).max(200).default([]),
  successMetrics: z.array(z.record(z.string(), z.unknown())).max(100).default([])
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({ data: await createMarketingCampaign(parsed.data) }, { status: 201 });
}
