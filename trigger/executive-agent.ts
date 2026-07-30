import { task } from "@trigger.dev/sdk";
import { requestModel } from "@/lib/ai/litellm";
import { parseModelJson } from "@/lib/ai/model-json";
import type { ExecutiveCommand } from "@/lib/domain";
import { dossierWorkerTask, scoutingLoopTask } from "@/trigger/collection-agent";
import { callWorkflowApp } from "@/lib/workflows/callback";
import {
  plannerResponseSchema,
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
    const outputLanguage = projectOutputLanguage(payload.context);
    const response = await requestModel(worker.modelRoute, [
      {
        role: "system",
        content: `${workerResultJsonInstruction(payload.task)}\n${languageInstruction(outputLanguage)}`
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
    const outputLanguage = projectOutputLanguage(context);
    await callWorkflowApp({
      action: "progress", commandId, runId,
      commandStatus: "planning", runStatus: "planning", progress: 10
    });

    const planningResponse = await requestModel("executive_reasoning", [
      {
        role: "system",
        content: [
          "Decide which of two shapes this instruction needs, then return JSON only matching that shape.",
          "",
          'Use "tasks" for a normal instruction: create an execution plan using the smallest suitable worker set.',
          'Return: {"kind":"tasks","objective":"string","reportTitle":"string","tasks":[{"key":"stable-key","workerType":"research|company_intelligence|marketing_strategy|ideation|content_writing|editing|extraction|data_enrichment|document_generation|email_drafting|translation|quality_review","instruction":"string","expectedOutput":"string","toolScopes":["string"],"budgetCents":0,"reviewRequired":false}],"reviewRecommendation":"string","estimatedCostCents":0}',
          "Use unique stable task keys. Limit tasks to 20. Never authorize external sends or direct client-data writes.",
          "",
          'Use "collection_project" only when the instruction asks to find or research MULTIPLE entities matching ' +
            "criteria and produce one document per entity, presented as a database (for example: " +
            '"find 100 companies on Kickstarter that make X, one profile each"). Infer the shape for THIS ' +
            "specific instruction - do not reuse a shape from a different domain.",
          'Return: {"kind":"collection_project","campaignName":"string","objective":"string",' +
            '"entitySchema":[{"name":"field_name","description":"string"}],' +
            '"documentTemplate":"markdown template describing what sections each entity document needs",' +
            '"dedupeKeys":["field_name from entitySchema"],' +
            '"qualificationRules":["string"],"discoveryQueries":["search query string"],' +
            '"targetCount":number-or-null,"saturationRule":"string-or-null describing when to stop if no fixed count"}',
          "Every dedupeKey must name one of the entitySchema fields declared in the same response. Provide " +
            "either targetCount or saturationRule (or both) so the discovery step knows when to stop.",
          languageInstruction(outputLanguage)
        ].join("\n")
      },
      { role: "user", content: JSON.stringify({ instruction: command.instruction, context }) }
    ], { runId });
    const plan = plannerResponseSchema.parse(
      parseModelJson(modelText(planningResponse))
    );

    if (plan.kind === "collection_project") {
      await callWorkflowApp({
        action: "progress", commandId, runId,
        commandStatus: "executing", runStatus: "executing", progress: 40
      });
      const projectId = command.projectId;
      if (!projectId) {
        throw new Error(
          "A collection project needs a project to attach its campaign, records, and documents to."
        );
      }
      const created = await callWorkflowApp<{ campaignId: string; agendaId: string }>({
        action: "collection_plan",
        runId,
        projectId,
        agendaId: command.context?.agendaId ?? null,
        plan
      });

      await callWorkflowApp({
        action: "progress", commandId, runId,
        commandStatus: "executing", runStatus: "executing", progress: 55
      });
      const scouting = await scoutingLoopTask.triggerAndWait({
        runId,
        campaignId: created.campaignId,
        projectId,
        agendaId: created.agendaId,
        entitySchema: plan.entitySchema,
        qualificationRules: plan.qualificationRules,
        discoveryQueries: plan.discoveryQueries
      });
      if (!scouting.ok) {
        throw new Error("Scouting Loop failed before any candidates could be confirmed.");
      }

      const fanout = await callWorkflowApp<{
        campaign: {
          entitySchema: Array<{ name: string; description: string }>;
          documentTemplate: string;
          qualificationRules: string[];
        };
        candidates: Array<{ id: string; data: Record<string, unknown> }>;
        pendingTotal: number;
      }>({ action: "dossier_fanout", runId, campaignId: created.campaignId });

      const dossiers = fanout.candidates.length === 0
        ? []
        : (await dossierWorkerTask.batchTriggerAndWait(
            fanout.candidates.map((candidate) => ({
              payload: {
                runId,
                campaignId: created.campaignId,
                projectId,
                agendaId: created.agendaId,
                candidateId: candidate.id,
                candidateData: candidate.data,
                entitySchema: fanout.campaign.entitySchema,
                documentTemplate: fanout.campaign.documentTemplate,
                qualificationRules: fanout.campaign.qualificationRules
              },
              options: { idempotencyKey: `${runId}:dossier:${candidate.id}` }
            }))
          )).runs;

      // One candidate failing is not the campaign failing - count the outcomes
      // and report them, rather than throwing away the dossiers that did
      // succeed because a sibling worker could not finish.
      const completed = dossiers.filter((run) => run.ok && run.output.status === "completed").length;
      const disqualified = dossiers.filter((run) => run.ok && run.output.status === "disqualified").length;
      // A candidate skipped because the budget ran out is a different fact from
      // one that was attempted and failed, and the difference is the one the
      // user needs to act on: raise the ceiling, or accept a partial campaign.
      const budgetStopped = dossiers.filter(
        (run) => run.ok && run.output.status === "budget_exhausted"
      ).length;
      const unfinished = dossiers.length - completed - disqualified - budgetStopped;

      await callWorkflowApp({
        action: "progress", commandId, runId,
        commandStatus: "executing", runStatus: "executing", progress: 90
      });

      const crossLink = await callWorkflowApp<{
        databaseId: string | null;
        changeSetId: string | null;
        published: number;
        skipped: number;
      }>({ action: "cross_link", runId, campaignId: created.campaignId });

      await callWorkflowApp({
        action: "note",
        runId,
        type: "run.collection_finished",
        message: `${completed} dossier(s) written, ${disqualified} disqualified, ` +
          `${unfinished} unfinished, from ${scouting.output.discovered} discovered candidate(s). ` +
          (budgetStopped > 0
            ? `${budgetStopped} candidate(s) were left unresearched because the campaign hit its ` +
              "spend ceiling - raise the project budget to continue them. "
            : "") +
          `${crossLink.published} document(s) created and staged as client-data rows for review; ` +
          "the rows are not in the database until approved."
      });
      await callWorkflowApp({
        action: "progress", commandId, runId,
        commandStatus: "review_required", runStatus: "review_required", progress: 100
      });
      await callWorkflowApp({ action: "terminal", commandId, runId, status: "completed" });
      return {
        ...created,
        scouting: scouting.output,
        dossiers: {
          completed, disqualified, budgetStopped, unfinished,
          pendingTotal: fanout.pendingTotal
        },
        crossLink
      };
    }

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
        content: `Review the worker outputs and produce a decision-ready report in markdown with executive summary, findings, sources, risks, recommendations, and next actions.\n${languageInstruction(outputLanguage)}`
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

function projectOutputLanguage(context: unknown): "en" | "ko" | "bilingual" {
  if (!context || typeof context !== "object") return "en";
  const project = (context as { project?: { outputLanguage?: unknown } }).project;
  return project?.outputLanguage === "ko" || project?.outputLanguage === "bilingual"
    ? project.outputLanguage
    : "en";
}

function languageInstruction(language: "en" | "ko" | "bilingual") {
  if (language === "ko") {
    return "Write user-facing output in Korean. Preserve source-language quotations and technical terms where accuracy requires them.";
  }
  if (language === "bilingual") {
    return "Write user-facing output bilingually, English first and Korean second. Preserve source-language evidence.";
  }
  return "Write user-facing output in English. Preserve source-language evidence without forced translation.";
}
