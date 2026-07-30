import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { notFound } from "@/lib/http";
import { logger } from "@/lib/observability/logger";
import { repository } from "@/lib/repository";
import { startLocalRun } from "@/lib/workflows/local-run";
import { dispatchCommand } from "@/lib/workflows/trigger";
import { registerWorkflowRun } from "@/lib/workflows/state";

/**
 * The route that actually spends money: confirming a command dispatches the
 * executive workflow, which for a collection campaign fans out to a hundred
 * paid workers. Rate limited on the `expensive` tier accordingly.
 */
export const POST = guard<{ commandId: string }>(async (_request, { params, session }) => {
  const command = await repository.updateCommand(params.commandId, {
    status: "confirmed",
    clarification: null
  });
  if (!command) return notFound("command");
  const run = await repository.createRun(command);
  const dispatch = await dispatchCommand(command.id, run.id);
  await repository.updateRun(run.id, { workflowRunId: dispatch.workflowRunId });
  await registerWorkflowRun(run.id, dispatch.workflowRunId);
  logger.info("command.confirmed", {
    commandId: command.id,
    runId: run.id,
    mode: dispatch.mode,
    userId: session.userId
  });
  if (dispatch.mode === "local") {
    await startLocalRun(command, run.id);
  }
  return NextResponse.json({
    data: command,
    run,
    workflow: { status: "queued", mode: dispatch.mode }
  });
}, { rateLimit: "expensive" });
