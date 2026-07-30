import { NextResponse } from "next/server";
import { getCampaignCoverage } from "@/lib/company-research";

import { guard } from "@/lib/api/guard";
export const GET = guard<{ campaignId: string }>(async (_request, { params }) => {
  const { campaignId } = params;
  const coverage = await getCampaignCoverage(campaignId);
  return coverage
    ? NextResponse.json({ data: coverage })
    : NextResponse.json({ error: "Research campaign not found." }, { status: 404 });
});
