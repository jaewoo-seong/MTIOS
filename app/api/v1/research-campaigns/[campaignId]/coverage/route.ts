import { NextResponse } from "next/server";
import { getCampaignCoverage } from "@/lib/company-research";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const coverage = await getCampaignCoverage(campaignId);
  return coverage
    ? NextResponse.json({ data: coverage })
    : NextResponse.json({ error: "Research campaign not found." }, { status: 404 });
}
