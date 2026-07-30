import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth";
import {
  getCollectionCampaign,
  listPendingDossierCandidates,
  setCollectionCampaignCeiling
} from "@/lib/collection-research";
import { parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";
import { registerWorkflowRun } from "@/lib/workflows/state";
import { dispatchCollectionContinuation } from "@/lib/workflows/trigger";

const schema = z.object({
  // Raising the ceiling is the same request as continuing, in practice: a
  // campaign that stopped on spend cannot make progress without it, and
  // making the operator issue two calls invites continuing into a ceiling
  // that has not moved.
  ceilingCents: z.number().int().min(1).max(100_000).nullable().optional(),
  resumeDiscovery: z.boolean().default(false)
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const actor = await currentSession();
  const { campaignId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;

  const campaign = await getCollectionCampaign(campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "Collection campaign not found." }, { status: 404 });
  }
  if (parsed.data.ceilingCents !== undefined) {
    await setCollectionCampaignCeiling(campaignId, parsed.data.ceilingCents);
  }

  const resumeDiscovery = parsed.data.resumeDiscovery ?? false;
  const pending = await listPendingDossierCandidates(campaignId);
  // Nothing to do is not an error, but it is worth saying explicitly rather
  // than spending a run to discover it. Resuming discovery is the one case
  // where an empty pending list is still meaningful work.
  if (pending.length === 0 && !resumeDiscovery) {
    return NextResponse.json({
      data: {
        continued: false,
        reason: "No candidates are pending. Pass resumeDiscovery to search for more."
      }
    });
  }
  if (!campaign.agendaId) {
    return NextResponse.json({
      error: "This campaign has no agenda to attach research to and cannot be continued."
    }, { status: 409 });
  }

  const command = await repository.createCommand({
    page: "collection-campaign",
    projectId: campaign.projectId,
    instruction: `Continue the "${campaign.name}" collection campaign.`,
    context: { page: "collection-campaign", projectId: campaign.projectId }
  }, actor.userId);
  await repository.updateCommand(command.id, { status: "confirmed" });
  const run = await repository.createRun(command);
  const dispatch = await dispatchCollectionContinuation({
    commandId: command.id,
    runId: run.id,
    campaignId,
    projectId: campaign.projectId,
    agendaId: campaign.agendaId,
    resumeDiscovery
  });
  await repository.updateRun(run.id, { workflowRunId: dispatch.workflowRunId });
  await registerWorkflowRun(run.id, dispatch.workflowRunId);

  if (dispatch.mode === "local") {
    // No managed backend means no worker will ever pick this up. Saying so on
    // the run is better than leaving a queued run that never moves.
    await repository.appendEvent(run.id, {
      type: "run.blocked",
      message: "Background execution is not configured, so this continuation cannot run. " +
        "Set TRIGGER_SECRET_KEY to enable it."
    });
    await repository.updateRun(run.id, { status: "review_required", progress: 100 });
  }

  return NextResponse.json({
    data: {
      continued: dispatch.mode === "managed",
      pendingTotal: pending.length,
      resumeDiscovery,
      run,
      workflow: { mode: dispatch.mode }
    }
  }, { status: 202 });
}
