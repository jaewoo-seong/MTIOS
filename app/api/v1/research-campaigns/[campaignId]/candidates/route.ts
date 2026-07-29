import { NextResponse } from "next/server";
import { parseJson } from "@/lib/http";
import { addCampaignCandidate } from "@/lib/company-research";
import { companyInputSchema } from "@/app/api/v1/companies/route";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const parsed = await parseJson(request, companyInputSchema);
  if (parsed.error) return parsed.error;
  try {
    return NextResponse.json({
      data: await addCampaignCandidate(campaignId, parsed.data)
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Candidate could not be added.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
