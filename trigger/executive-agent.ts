import { task } from "@trigger.dev/sdk";
import { requestModel } from "@/lib/ai/litellm";
import { parseModelJson } from "@/lib/ai/model-json";
import type { ExecutiveCommand } from "@/lib/domain";

type WorkerPayload = {
  runId: string;
  instruction: string;
  context: unknown;
};

type ModelResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

function modelText(response: unknown) {
  const content = (response as ModelResponse).choices?.[0]?.message?.content;
  if (!content) throw new Error("LiteLLM returned no message content.");
  return content;
}

async function callWorkflowApp<T>(body: Record<string, unknown>): Promise<T> {
  const baseUrl = process.env.BUSINESS_OS_INTERNAL_URL;
  const secret = process.env.WORKFLOW_CALLBACK_SECRET;
  if (!baseUrl || !secret) {
    throw new Error("Workflow app callback is not configured.");
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/internal/workflow`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Workflow app request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const workerAgentTask = task({
  id: "worker-agent",
  queue: { concurrencyLimit: 10 },
  maxDuration: 1800,
  run: async (payload: WorkerPayload) => {
    const response = await requestModel("worker_research", [
      {
        role: "system",
        content: "Complete the assigned business task. Return factual markdown with explicit sources, assumptions, and unresolved questions."
      },
      {
        role: "user",
        content: JSON.stringify({ instruction: payload.instruction, context: payload.context })
      }
    ]);
    return { instruction: payload.instruction, output: modelText(response) };
  }
});

export const executiveAgentWorkflow = task({
  id: "executive-agent-workflow",
  maxDuration: 7200,
  run: async ({ commandId, runId }: { commandId: string; runId: string }) => {
    const loaded = await callWorkflowApp<{ command: ExecutiveCommand; context: unknown }>({
      action: "load",
      commandId
    });
    const { command, context } = loaded;
    await callWorkflowApp({
      action: "progress", commandId, runId,
      commandStatus: "planning", runStatus: "planning", progress: 10
    });

    const planningResponse = await requestModel("executive_reasoning", [
      {
        role: "system",
        content: "Create a concise execution plan. Return JSON only: {\"tasks\":[\"...\"],\"reportTitle\":\"...\"}. Limit tasks to 10."
      },
      { role: "user", content: JSON.stringify({ instruction: command.instruction, context }) }
    ]);
    const plan = parseModelJson<{ tasks: string[]; reportTitle: string }>(
      modelText(planningResponse)
    );
    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0 || plan.tasks.length > 10) {
      throw new Error("Executive plan contains an invalid task list.");
    }

    await callWorkflowApp({
      action: "progress", commandId, runId,
      commandStatus: "executing", runStatus: "executing", progress: 25
    });
    const results = await workerAgentTask.batchTriggerAndWait(
      plan.tasks.map((instruction) => ({ payload: { runId, instruction, context } }))
    );
    const workerOutputs = results.runs.map((result, index) => {
      if (!result.ok) throw new Error(`Worker task ${index + 1} failed.`);
      return result.output;
    });

    await callWorkflowApp({ action: "progress", commandId, runId, progress: 80 });
    const reviewResponse = await requestModel("executive_review", [
      {
        role: "system",
        content: "Review the worker outputs and produce a decision-ready report in markdown with executive summary, findings, sources, risks, recommendations, and next actions."
      },
      {
        role: "user",
        content: JSON.stringify({ instruction: command.instruction, context, workerOutputs })
      }
    ]);
    const content = modelText(reviewResponse);
    return callWorkflowApp({
      action: "report",
      commandId,
      runId,
      projectId: command.projectId,
      title: plan.reportTitle,
      summary: content.slice(0, 500),
      content
    });
  }
});
