type TriggerDispatch = {
  workflowRunId: string | null;
  mode: "managed" | "local";
};

export async function dispatchCommand(commandId: string, runId: string): Promise<TriggerDispatch> {
  const endpoint = process.env.TRIGGER_DISPATCH_URL;
  const secret = process.env.TRIGGER_SECRET_KEY;

  if (!endpoint || !secret) {
    return { workflowRunId: null, mode: "local" };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "Idempotency-Key": commandId
    },
    body: JSON.stringify({ commandId, runId })
  });

  if (!response.ok) {
    throw new Error(`Trigger.dev dispatch failed with status ${response.status}`);
  }

  const body = (await response.json()) as { id?: string };
  return { workflowRunId: body.id ?? null, mode: "managed" };
}
