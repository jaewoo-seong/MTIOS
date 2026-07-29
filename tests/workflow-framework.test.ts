import { describe, expect, it } from "vitest";
import {
  executionPlanSchema,
  workerCatalog,
  workerResultSchema,
  workerTypes
} from "@/lib/workflows/contracts";
import {
  persistWorkflowPlan,
  persistWorkerResult,
  reconcileWorkflowTerminal
} from "@/lib/workflows/state";
import { repository } from "@/lib/repository";

const plan = executionPlanSchema.parse({
  objective: "Build and review a cross-functional launch package.",
  reportTitle: "Launch package",
  tasks: [
    {
      key: "strategy",
      workerType: "marketing_strategy",
      instruction: "Create positioning alternatives from approved context.",
      expectedOutput: "Structured strategy options",
      toolScopes: ["project:read"],
      budgetCents: 200,
      reviewRequired: true
    },
    {
      key: "draft",
      workerType: "content_writing",
      instruction: "Draft launch content using the selected positioning.",
      expectedOutput: "Editable content draft",
      toolScopes: ["project:read"],
      budgetCents: 200,
      reviewRequired: true
    }
  ],
  reviewRecommendation: "Review positioning before external use.",
  estimatedCostCents: 500
});

describe("workflow contracts", () => {
  it("defines every reusable worker with a model route and system policy", () => {
    expect(Object.keys(workerCatalog).sort()).toEqual([...workerTypes].sort());
    expect(workerCatalog.email_drafting.systemPrompt).toContain("Never send");
  });

  it("rejects duplicate task keys and malformed worker results", () => {
    expect(() => executionPlanSchema.parse({
      ...plan,
      tasks: [plan.tasks[0], plan.tasks[0]]
    })).toThrow(/unique/i);
    expect(() => workerResultSchema.parse({
      taskKey: "strategy",
      workerType: "marketing_strategy",
      summary: ""
    })).toThrow();
  });
});

describe("workflow persistence", () => {
  it("persists plans idempotently, records worker output, and reconciles failure", async () => {
    const project = await repository.createProject({
      name: "Workflow framework verification",
      objective: "Verify reusable worker persistence and terminal reconciliation.",
      context: "",
      scope: "",
      constraints: [],
      budgetCents: 1000
    });
    const command = await repository.createCommand({
      page: "projects",
      projectId: project.id,
      instruction: "Build a launch strategy and editable content package for review."
    });
    const run = await repository.createRun(command);

    const first = await persistWorkflowPlan(run.id, plan);
    const second = await persistWorkflowPlan(run.id, plan);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);

    const result = workerResultSchema.parse({
      taskKey: "strategy",
      workerType: "marketing_strategy",
      summary: "Three positioning options prepared.",
      findings: [],
      artifacts: [],
      assumptions: [],
      unresolvedQuestions: [],
      reviewRequired: true
    });
    expect(await persistWorkerResult(run.id, result)).toBeTruthy();

    await reconcileWorkflowTerminal({
      runId: run.id,
      commandId: command.id,
      status: "failed",
      error: "Provider retries exhausted."
    });
    expect((await repository.getRun(run.id))?.status).toBe("failed");
    expect((await repository.listEvents(run.id)).at(-1)?.type).toBe("run.failed");
  });

  it("blocks plans exceeding project budget", async () => {
    const project = await repository.createProject({
      name: "Budget verification",
      objective: "Verify workflow plans cannot exceed the project budget.",
      context: "",
      scope: "",
      constraints: [],
      budgetCents: 100
    });
    const command = await repository.createCommand({
      page: "projects",
      projectId: project.id,
      instruction: "Prepare a complete campaign package under the assigned project budget."
    });
    const run = await repository.createRun(command);
    await expect(persistWorkflowPlan(run.id, plan)).rejects.toThrow(/project budget/i);
  });
});
