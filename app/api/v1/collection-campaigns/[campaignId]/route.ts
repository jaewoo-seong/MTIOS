import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { getClientChangeSet } from "@/lib/client-changes";
import {
  CAMPAIGN_DEFAULT_CEILING_CENTS,
  getCampaignEvidenceStats,
  getCollectionCampaign,
  getCollectionCoverage,
  listCollectionCandidates,
  listCollectionDirectives,
  reconcileCollectionRecordLinks
} from "@/lib/collection-research";
import { repository } from "@/lib/repository";

export const GET = guard<{ campaignId: string }>(async (_request, { params }) => {
  const { campaignId } = params;
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

  const candidates = await listCollectionCandidates(campaignId);
  const project = await repository.getProject(campaign.projectId);
  // Reported rather than recomputed through getCollectionBudget, because that
  // function writes spend back to the campaign and a read should not have
  // accounting side effects. These are the persisted figures the last budget
  // check produced.
  const authorizedCeiling = campaign.ceilingCents ?? CAMPAIGN_DEFAULT_CEILING_CENTS;
  const effectiveCeiling = project?.budgetCents === null || project?.budgetCents === undefined
    ? authorizedCeiling
    : Math.min(authorizedCeiling, project.budgetCents);

  return NextResponse.json({
    data: {
      campaign,
      coverage: await getCollectionCoverage(campaignId),
      budget: {
        ceilingCents: effectiveCeiling,
        authorizedCeilingCents: authorizedCeiling,
        spentCents: campaign.costCents,
        researchCostCents: campaign.researchCostCents,
        modelCostCents: Math.max(0, campaign.costCents - campaign.researchCostCents),
        remainingCents: Math.max(0, effectiveCeiling - campaign.costCents),
        exhausted: campaign.costCents >= effectiveCeiling,
        // Says which limit is actually binding, so raising the wrong one is not
        // the operator's first guess when a campaign stops short.
        ceilingSource: effectiveCeiling < authorizedCeiling
          ? "project"
          : campaign.ceilingCents === null ? "default" : "campaign"
      },
      directives: await listCollectionDirectives(campaignId),
      evidenceReuse: await getCampaignEvidenceStats(campaignId),
      pendingCount: candidates.filter((candidate) => candidate.dossierStatus === "pending").length,
      candidates: candidates.map((candidate) => ({
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
});
