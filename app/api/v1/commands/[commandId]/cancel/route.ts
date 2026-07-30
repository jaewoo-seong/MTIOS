import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";
import { reconcileWorkflowTerminal } from "@/lib/workflows/state";
import { cancelWorkflowRun } from "@/lib/workflows/trigger";

const STOPPABLE = new Set([
  "draft",
  "needs_clarification",
  "awaiting_confirmation",
  "confirmed",
  "planning",
  "executing",
  "review_required"
]);

/**
 * Stops a command and whatever run it started.
 *
 * The app's own state is marked cancelled first and the backend is asked
 * second, deliberately. A person who clicks stop needs the system to agree that
 * it is stopping even if Trigger.dev is briefly unreachable; the reverse order
 * would leave a run the operator was told was stopping still marked executing.
 * The task's onCancel handler reconciles when the cancellation lands, and
 * reconcileWorkflowTerminal is idempotent, so the two paths converging on the
 * same run is harmless.
 *
 * Work already finished is kept. Cancelling a collection campaign leaves its
 * completed dossiers, its documents, and any staged rows exactly where they
 * are - the campaign can still be continued later.
 */
export async function POST(_: Request, { params }: { params: Promise<{ commandId: string }> }) {
  await currentSession();
  const { commandId } = await params;
  const command = await repository.getCommand(commandId);
  if (!command) return notFound("command");
  if (!STOPPABLE.has(command.status)) {
    return NextResponse.json({
      error: `A ${command.status.replace("_", " ")} command cannot be cancelled.`
    }, { status: 409 });
  }

  const commandRuns = await repository.listRunsForCommand(commandId);
  const active = commandRuns.filter(
    (run) => !["completed", "failed", "cancelled"].includes(run.status)
  );

  for (const run of active) {
    await reconcileWorkflowTerminal({
      runId: run.id,
      commandId,
      status: "cancelled",
      error: "Cancelled by the operator. Completed work is kept."
    });
  }
  if (active.length === 0) {
    // A command with no live run still needs its own status moved, otherwise a
    // command cancelled before dispatch stays queued forever.
    await repository.updateCommand(commandId, { status: "cancelled" });
  }

  const cancelled = await Promise.all(
    active.map((run) => cancelWorkflowRun(run.workflowRunId))
  );

  return NextResponse.json({
    data: {
      commandId,
      cancelledRuns: active.length,
      backendCancelled: cancelled.filter(Boolean).length,
      note: "Completed work is kept. A collection campaign can be continued later."
    }
  });
}
