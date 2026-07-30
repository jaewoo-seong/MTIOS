import { task } from "@trigger.dev/sdk";
import { callWorkflowApp } from "@/lib/workflows/callback";
import { dossierWorkerTask, scoutingLoopTask } from "@/trigger/collection-agent";

/**
 * Phase 13 continuation. Picks a campaign back up from wherever it stopped.
 *
 * A campaign run can end with work still outstanding for three unrelated
 * reasons: discovery hit its round ceiling before reaching the target, the
 * fan-out ceiling deferred candidates it had already discovered, or the spend
 * ceiling stopped it mid-dossier. All three leave candidates sitting at
 * `pending`, and before this task existed nothing ever looked at them again -
 * the only recourse was issuing a fresh instruction, which created a second
 * campaign that rediscovered and re-paid for everything the first had found.
 *
 * This is deliberately not a retry of the original workflow. It skips
 * planning entirely, because the Blueprint is already decided and re-running a
 * planner against the same instruction risks inferring a different entity
 * shape than the one the campaign's existing rows were built against.
 */
export type ContinuationPayload = {
  runId: string;
  commandId: string;
  campaignId: string;
  projectId: string;
  agendaId: string;
  /** Resume discovery too, rather than only researching what is already found. */
  resumeDiscovery: boolean;
};

type ContinuationContext = {
  campaign: {
    id: string;
    name: string;
    entitySchema: Array<{ name: string; description: string }>;
    documentTemplate: string;
    qualificationRules: string[];
    discoveryQueries: string[];
    targetCount: number | null;
    status: string;
    discoveredCount: number;
  };
  pendingTotal: number;
  budget: { exhausted: boolean; ceilingCents: number; spentCents: number };
};

export const collectionContinuationTask = task({
  id: "collection-continuation",
  maxDuration: 7200,
  onFailure: async ({ payload, error }) => {
    await callWorkflowApp({
      action: "terminal",
      commandId: payload.commandId,
      runId: payload.runId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
  },
  onCancel: async ({ payload }) => {
    await callWorkflowApp({
      action: "terminal",
      commandId: payload.commandId,
      runId: payload.runId,
      status: "cancelled"
    });
  },
  run: async (payload: ContinuationPayload) => {
    const context = await callWorkflowApp<ContinuationContext>({
      action: "collection_continue_load",
      runId: payload.runId,
      campaignId: payload.campaignId,
      resumeDiscovery: payload.resumeDiscovery
    });

    // Checked up front rather than letting each worker discover it: a
    // continuation started against an already-exhausted ceiling should say so
    // plainly instead of spawning workers that each stop on arrival.
    if (context.budget.exhausted) {
      await callWorkflowApp({
        action: "note",
        runId: payload.runId,
        type: "run.collection_continuation_blocked",
        message: `Campaign has already spent ${context.budget.spentCents} of its ` +
          `${context.budget.ceilingCents} cent ceiling. Raise the ceiling to continue it.`
      });
      await callWorkflowApp({
        action: "terminal", commandId: payload.commandId, runId: payload.runId, status: "completed"
      });
      return { campaignId: payload.campaignId, blocked: "budget_exhausted" as const };
    }

    await callWorkflowApp({
      action: "progress", commandId: payload.commandId, runId: payload.runId,
      commandStatus: "executing", runStatus: "executing", progress: 20
    });

    let discovered = context.campaign.discoveredCount;
    if (payload.resumeDiscovery) {
      const scouting = await scoutingLoopTask.triggerAndWait({
        runId: payload.runId,
        campaignId: payload.campaignId,
        projectId: payload.projectId,
        agendaId: payload.agendaId,
        entitySchema: context.campaign.entitySchema,
        qualificationRules: context.campaign.qualificationRules,
        discoveryQueries: context.campaign.discoveryQueries,
        targetCount: context.campaign.targetCount,
        // Sizes the round budget against what is still missing rather than
        // against the full target, so a campaign continued at 80 of 100 gets a
        // short discovery pass instead of a full-length one.
        alreadyDiscovered: discovered
      });
      if (scouting.ok) discovered = scouting.output.discovered;
    }

    await callWorkflowApp({
      action: "progress", commandId: payload.commandId, runId: payload.runId,
      commandStatus: "executing", runStatus: "executing", progress: 50
    });

    const fanout = await callWorkflowApp<{
      campaign: {
        entitySchema: Array<{ name: string; description: string }>;
        documentTemplate: string;
        qualificationRules: string[];
      };
      candidates: Array<{ id: string; data: Record<string, unknown> }>;
      pendingTotal: number;
    }>({ action: "dossier_fanout", runId: payload.runId, campaignId: payload.campaignId });

    const dossiers = fanout.candidates.length === 0
      ? []
      : (await dossierWorkerTask.batchTriggerAndWait(
          fanout.candidates.map((candidate) => ({
            payload: {
              runId: payload.runId,
              campaignId: payload.campaignId,
              projectId: payload.projectId,
              agendaId: payload.agendaId,
              candidateId: candidate.id,
              candidateData: candidate.data,
              entitySchema: fanout.campaign.entitySchema,
              documentTemplate: fanout.campaign.documentTemplate,
              qualificationRules: fanout.campaign.qualificationRules
            },
            options: { idempotencyKey: `${payload.runId}:dossier:${candidate.id}` }
          }))
        )).runs;

    const completed = dossiers.filter((run) => run.ok && run.output.status === "completed").length;
    const disqualified = dossiers.filter((run) => run.ok && run.output.status === "disqualified").length;
    const budgetStopped = dossiers.filter(
      (run) => run.ok && run.output.status === "budget_exhausted"
    ).length;
    const unfinished = dossiers.length - completed - disqualified - budgetStopped;

    await callWorkflowApp({
      action: "progress", commandId: payload.commandId, runId: payload.runId,
      commandStatus: "executing", runStatus: "executing", progress: 90
    });

    const crossLink = await callWorkflowApp<{
      databaseId: string | null;
      changeSetId: string | null;
      published: number;
      skipped: number;
    }>({ action: "cross_link", runId: payload.runId, campaignId: payload.campaignId });

    await callWorkflowApp({
      action: "note",
      runId: payload.runId,
      type: "run.collection_continued",
      message: `Continuation researched ${completed} more dossier(s), ${disqualified} disqualified, ` +
        `${unfinished} unfinished, from ${discovered} discovered candidate(s). ` +
        (budgetStopped > 0
          ? `${budgetStopped} candidate(s) still await research because the campaign reached its ` +
            "spend ceiling - raise the ceiling and continue again. "
          : "") +
        `${crossLink.published} new document(s) created and staged as client-data rows for review.`
    });
    await callWorkflowApp({
      action: "progress", commandId: payload.commandId, runId: payload.runId,
      commandStatus: "review_required", runStatus: "review_required", progress: 100
    });
    await callWorkflowApp({
      action: "terminal", commandId: payload.commandId, runId: payload.runId, status: "completed"
    });

    return {
      campaignId: payload.campaignId,
      discovered,
      dossiers: { completed, disqualified, budgetStopped, unfinished },
      crossLink
    };
  }
});
