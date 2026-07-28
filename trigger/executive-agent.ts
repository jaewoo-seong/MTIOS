import { task } from "@trigger.dev/sdk";
import { buildAgentContext } from "@/lib/ai/context";
import { requestModel } from "@/lib/ai/litellm";
import { repository } from "@/lib/repository";

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
    const command = await repository.getCommand(commandId);
    if (!command) throw new Error("Command not found.");

    await repository.updateCommand(command.id, { status: "planning" });
    await repository.updateRun(runId, { status: "planning", progress: 10 });
    const context = await buildAgentContext(command.projectId);

    const planningResponse = await requestModel("executive_reasoning", [
      {
        role: "system",
        content: "Create a concise execution plan. Return JSON only: {\"tasks\":[\"...\"],\"reportTitle\":\"...\"}. Limit tasks to 10."
      },
      { role: "user", content: JSON.stringify({ instruction: command.instruction, context }) }
    ]);
    const plan = JSON.parse(modelText(planningResponse)) as { tasks: string[]; reportTitle: string };
    if (!Array.isArray(plan.tasks) || plan.tasks.length === 0 || plan.tasks.length > 10) {
      throw new Error("Executive plan contains an invalid task list.");
    }

    await repository.updateCommand(command.id, { status: "executing" });
    await repository.updateRun(runId, { status: "executing", progress: 25 });
    const results = await workerAgentTask.batchTriggerAndWait(
      plan.tasks.map((instruction) => ({ payload: { runId, instruction, context } }))
    );
    const workerOutputs = results.runs.map((result, index) => {
      if (!result.ok) throw new Error(`Worker task ${index + 1} failed.`);
      return result.output;
    });

    await repository.updateRun(runId, { progress: 80 });
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
    const report = await repository.createReport({
      projectId: command.projectId,
      title: plan.reportTitle,
      summary: content.slice(0, 500),
      content
    });

    await repository.updateCommand(command.id, { status: "review_required" });
    await repository.updateRun(runId, { status: "review_required", progress: 100 });
    return { reportId: report.id, status: "review_required" };
  }
});
