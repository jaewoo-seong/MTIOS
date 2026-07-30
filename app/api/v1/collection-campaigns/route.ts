import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import {
  CAMPAIGN_DEFAULT_CEILING_CENTS,
  collectionCoverage,
  listCollectionCampaigns
} from "@/lib/collection-research";

export const GET = guard(async (request) => {
  const projectId = new URL(request.url).searchParams.get("projectId");
  const campaigns = await listCollectionCampaigns(projectId ?? undefined);
  return NextResponse.json({
    data: campaigns.map((campaign) => ({
      campaign,
      coverage: collectionCoverage(campaign),
      ceilingCents: campaign.ceilingCents ?? CAMPAIGN_DEFAULT_CEILING_CENTS
    }))
  });
});
