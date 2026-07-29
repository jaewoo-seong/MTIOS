import { task } from "@trigger.dev/sdk";
import { requestModel } from "@/lib/ai/litellm";
import { parseModelJson } from "@/lib/ai/model-json";
import type { ExecutiveCommand } from "@/lib/domain";
import {
  executionPlanSchema,
  workerCatalog,
  workerResultJsonInstruction,
  workerResultSchema,
  type DelegatedTask,
  type WorkerResult
} from "@/lib/workflows/contracts";

type WorkerPayload = {
  runId: string;
  task: DelegatedTask;
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
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
    factor: 2,
    randomize: true
  },
  onStartAttempt: async ({ payload, ctx }) => {
    await callWorkflowApp({
      action: "worker_attempt",
      runId: payload.runId,
      taskKey: payload.task.key,
      attempt: ctx.attempt.number
    });
  },
  run: async (payload: WorkerPayload) => {
    const worker = workerCatalog[payload.task.workerType];
    const response = await requestModel(worker.modelRoute, [
      {
        role: "system",
        content: workerResultJsonInstruction(payload.task)
      },
      {
        role: "user",
        content: JSON.stringify({ task: payload.task, context: payload.context })
      }
    ], { runId: payload.runId });
    const result = workerResultSchema.parse(
      parseModelJson<WorkerResult>(modelText(response))
    );
    await callWorkflowApp({ action: "worker_result", runId: payload.runId, result });
    return result;
  }
});

export const executiveAgentWorkflow = task({
  id: "executive-agent-workflow",
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
  run: async ({ commandId, runId }: { commandId: string; runId: string }) => {
    const loaded = await callWorkflowApp<{ command: ExecutiveCommand; context: unknown }>({
      action: "load",
      commandId,
      runId
    });
    const { command, context } = loaded;
    await callWorkflowApp({
      action: "progress", commandId, runId,
      commandStatus: "planning", runStatus: "planning", progress: 10
    });

    const planningResponse = await requestModel("executive_reasoning", [
      {
        role: "system",
        content: [
          "Create an execution plan using the smallest suitable worker set.",
          "Return JSON only matching:",
          '{"objective":"string","reportTitle":"string","tasks":[{"key":"stable-key","workerType":"research|company_intelligence|marketing_strategy|ideation|content_writing|editing|extraction|data_enrichment|document_generation|email_drafting|translation|quality_review","instruction":"string","expectedOutput":"string","toolScopes":["string"],"budgetCents":0,"reviewRequired":false}],"reviewRecommendation":"string","estimatedCostCents":0}',
          "Use unique stable task keys. Limit tasks to 20. Never authorize external sends or direct client-data writes."
        ].join("\n")
      },
      { role: "user", content: JSON.stringify({ instruction: command.instruction, context }) }
    ], { runId });
    const plan = executionPlanSchema.parse(
      parseModelJson(modelText(planningResponse))
    );
    await callWorkflowApp({ action: "plan", runId, plan });

    await callWorkflowApp({
      action: "progress", commandId, runId,
      commandStatus: "executing", runStatus: "executing", progress: 25
    });
    const results = await workerAgentTask.batchTriggerAndWait(
      plan.tasks.map((task) => ({
        payload: { runId, task, context },
        options: { idempotencyKey: `${runId}:${task.key}` }
      }))
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
    ], { runId });
    const content = modelText(reviewResponse);
    const report = await callWorkflowApp({
      action: "report",
      commandId,
      runId,
      projectId: command.projectId,
      title: plan.reportTitle,
      summary: content.slice(0, 500),
      content
    });
    await callWorkflowApp({ action: "terminal", commandId, runId, status: "completed" });
    return report;
  }
});
