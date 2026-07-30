import { NextResponse } from "next/server";
import { z } from "zod";
import { proposeExternalMarketingAction } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  projectId: z.string().uuid(),
  campaignId: z.string().uuid().nullable().optional(),
  actionType: z.enum(["publish", "send", "activate_ad"]),
  payload: z.record(z.string(), z.unknown()),
  reason: z.string().trim().min(2).max(5000)
});

export const POST = guard(async (request) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const proposal = await proposeExternalMarketingAction(parsed.data);
  return NextResponse.json({ data: proposal }, { status: 202 });
});
