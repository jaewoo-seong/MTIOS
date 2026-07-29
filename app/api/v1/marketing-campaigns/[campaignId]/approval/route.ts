import { NextResponse } from "next/server";
import { z } from "zod";
import { setMarketingCampaignApproval } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

const schema = z.object({
  approvalState: z.enum(["working", "approved", "rejected"]),
  status: z.string().trim().min(1).max(60).optional()
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const campaign = await setMarketingCampaignApproval(
    campaignId,
    parsed.data.approvalState,
    parsed.data.status
  );
  return campaign
    ? NextResponse.json({ data: campaign })
    : NextResponse.json({ error: "Marketing campaign not found." }, { status: 404 });
}
