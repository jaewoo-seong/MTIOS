import { NextResponse } from "next/server";
import { getClientChangeSet } from "@/lib/client-changes";
import {
  getCollectionCampaign,
  getCollectionCoverage,
  listCollectionCandidates,
  reconcileCollectionRecordLinks
} from "@/lib/collection-research";
import { repository } from "@/lib/repository";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  const campaign = await getCollectionCampaign(campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "Collection campaign not found." }, { status: 404 });
  }

  // Reading is when we learn whether the campaign's change set has been
  // approved since the run finished, so this is where the record half of the
  // Stage 5 cross-link gets completed. It is idempotent.
  const reconciled = await reconcileCollectionRecordLinks(campaignId, {
    getChangeSetStatus: async (changeSetId) => (await getClientChangeSet(changeSetId))?.status ?? null,
    listRecords: async (databaseId) => (await repository.listRecords(databaseId)).map((record) => ({
      id: record.id,
      data: record.data
    }))
  });

  return NextResponse.json({
    data: {
      campaign,
      coverage: await getCollectionCoverage(campaignId),
      candidates: (await listCollectionCandidates(campaignId)).map((candidate) => ({
        id: candidate.id,
        data: candidate.data,
        dossierStatus: candidate.dossierStatus,
        dossierReason: candidate.dossierReason,
        linkedRecordId: candidate.linkedRecordId,
        linkedDocumentId: candidate.linkedDocumentId
      })),
      recordLinks: reconciled
    }
  });
}
