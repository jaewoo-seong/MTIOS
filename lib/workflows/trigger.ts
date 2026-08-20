import { runs, tasks } from "@trigger.dev/sdk";

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

/**
 * Dispatches a continuation for a campaign that stopped with work outstanding.
 *
 * Keyed on the run rather than the campaign, because continuing the same
 * campaign more than once is the expected path - raise the ceiling, continue,
 * raise again - and a campaign-scoped key would make every continuation after
 * the first a silent no-op.
 */
export async function dispatchCollectionContinuation(input: {
  commandId: string;
  runId: string;
  campaignId: string;
  projectId: string;
  agendaId: string;
  resumeDiscovery: boolean;
}): Promise<TriggerDispatch> {
  if (!process.env.TRIGGER_SECRET_KEY) {
    return { workflowRunId: null, mode: "local" };
  }
  const handle = await tasks.trigger("collection-continuation", input, {
    idempotencyKey: `continue:${input.runId}`
  });
  return { workflowRunId: handle.id, mode: "managed" };
}

export async function dispatchDossierRevision(requestId: string): Promise<TriggerDispatch> {
  if (!process.env.TRIGGER_SECRET_KEY) return { workflowRunId: null, mode: "local" };
  const handle = await tasks.trigger("dossier-revision-worker", { requestId }, {
    idempotencyKey: `dossier-revision:${requestId}`
  });
  return { workflowRunId: handle.id, mode: "managed" };
}

export async function dispatchResearchProject(projectId: string, idempotencyKey?: string): Promise<TriggerDispatch> {
  if (!process.env.TRIGGER_SECRET_KEY) return { workflowRunId: null, mode: "local" };
  const handle = await tasks.trigger("research-project-dispatcher", { projectId }, {
    idempotencyKey: idempotencyKey ?? `research-dispatch:${projectId}:${Date.now()}`
  });
  return { workflowRunId: handle.id, mode: "managed" };
}

export async function dispatchResearchDiscovery(projectId: string, idempotencyKey?: string): Promise<TriggerDispatch> {
  if (!process.env.TRIGGER_SECRET_KEY) return { workflowRunId: null, mode: "local" };
  const handle = await tasks.trigger("research-discovery-worker", { projectId, cyclesRemaining: 3 }, {
    idempotencyKey: idempotencyKey ?? `research-discovery:${projectId}:${Date.now()}`
  });
  return { workflowRunId: handle.id, mode: "managed" };
}

export async function dispatchNotificationDelivery(
  notificationId: string,
  idempotencyKey = `notification:${notificationId}`
): Promise<TriggerDispatch> {
  if (!process.env.TRIGGER_SECRET_KEY) {
    const { deliverNotification } = await import("@/lib/notifications");
    await deliverNotification(notificationId);
    return { workflowRunId: null, mode: "local" };
  }
  const handle = await tasks.trigger("email-notification-delivery", { notificationId }, {
    idempotencyKey
  });
  return { workflowRunId: handle.id, mode: "managed" };
}

/**
 * Asks Trigger.dev to cancel a run in flight.
 *
 * Best-effort by design: the app's own state is already marked cancelled by the
 * caller before this is attempted, so a cancellation that cannot reach the
 * backend must not resurrect a run the person has been told is stopping. The
 * task's own onCancel handler reconciles state if and when it does land.
 */
export async function cancelWorkflowRun(workflowRunId: string | null): Promise<boolean> {
  if (!workflowRunId || !process.env.TRIGGER_SECRET_KEY) return false;
  try {
    await runs.cancel(workflowRunId);
    return true;
  } catch {
    return false;
  }
}
