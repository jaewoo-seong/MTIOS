import { NextResponse } from "next/server";
import { z } from "zod";
import { addMarketingConcept } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  title: z.string().trim().min(1).max(300),
  rationale: z.string().max(10000).default(""),
  content: z.record(z.string(), z.unknown()).default({}),
  position: z.number().int().min(0).default(0)
});

export const POST = guard<{ campaignId: string }>(async (request, { params }) => {
  const { campaignId } = params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await addMarketingConcept(campaignId, parsed.data)
  }, { status: 201 });
});
