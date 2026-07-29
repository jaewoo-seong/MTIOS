import { NextResponse } from "next/server";
import { z } from "zod";
import { markCampaignSaturated } from "@/lib/company-research";
import { parseJson } from "@/lib/http";

const saturationSchema = z.object({
  reason: z.string().trim().min(5).max(2000),
  estimatedRemaining: z.number().int().min(0).default(0)
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const parsed = await parseJson(request, saturationSchema);
  if (parsed.error) return parsed.error;
  const campaign = await markCampaignSaturated(
    campaignId,
    parsed.data.reason,
    parsed.data.estimatedRemaining
  );
  return campaign
    ? NextResponse.json({ data: campaign })
    : NextResponse.json({ error: "Research campaign not found." }, { status: 404 });
}
