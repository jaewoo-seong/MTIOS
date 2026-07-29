import { tasks } from "@trigger.dev/sdk";

type TriggerDispatch = {
  workflowRunId: string | null;
  mode: "managed" | "local";
};

export async function dispatchCommand(
  commandId: string,
  runId: string,
  idempotencyKey = commandId
): Promise<TriggerDispatch> {
  const secret = process.env.TRIGGER_SECRET_KEY;

  if (!secret) {
    return { workflowRunId: null, mode: "local" };
  }

  const handle = await tasks.trigger("executive-agent-workflow", { commandId, runId }, {
    idempotencyKey
  });
  return { workflowRunId: handle.id, mode: "managed" };
}
