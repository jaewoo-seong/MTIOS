import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";
import { startLocalRun } from "@/lib/workflows/local-run";
import { dispatchCommand } from "@/lib/workflows/trigger";
import { registerWorkflowRun } from "@/lib/workflows/state";

export async function POST(_: Request, { params }: { params: Promise<{ commandId: string }> }) {
  const { commandId } = await params;
  const command = await repository.updateCommand(commandId, {
    status: "confirmed",
    clarification: null
  });
  if (!command) return notFound("command");
  const run = await repository.createRun(command);
  const dispatch = await dispatchCommand(command.id, run.id);
  await repository.updateRun(run.id, { workflowRunId: dispatch.workflowRunId });
  await registerWorkflowRun(run.id, dispatch.workflowRunId);
  if (dispatch.mode === "local") {
    await startLocalRun(command, run.id);
  }
  return NextResponse.json({
    data: command,
    run,
    workflow: { status: "queued", mode: dispatch.mode }
  });
}
