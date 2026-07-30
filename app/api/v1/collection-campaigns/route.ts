import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import {
  CAMPAIGN_DEFAULT_CEILING_CENTS,
  getCollectionCoverage,
  listCollectionCampaigns
} from "@/lib/collection-research";

export async function GET(request: Request) {
  await currentSession();
  const projectId = new URL(request.url).searchParams.get("projectId");
  const campaigns = await listCollectionCampaigns(projectId ?? undefined);
  return NextResponse.json({
    data: await Promise.all(campaigns.map(async (campaign) => ({
      campaign,
      coverage: await getCollectionCoverage(campaign.id),
      ceilingCents: campaign.ceilingCents ?? CAMPAIGN_DEFAULT_CEILING_CENTS
    })))
  });
}
