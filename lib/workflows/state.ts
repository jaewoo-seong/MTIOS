import { and, eq } from "drizzle-orm";
import type { ExecutionPlan, WorkerResult, WorkerType } from "@/lib/workflows/contracts";
import { workerCatalog } from "@/lib/workflows/contracts";
import { db } from "@/lib/db/client";
import {
  budgetLedgers,
  deadLetters,
  workflowPlans,
  workflowStates,
  workerRuns,
  premiumModelApprovals
} from "@/lib/db/schema";
import { MTI_ORGANIZATION_ID, repository } from "@/lib/repository";

type MemoryWorkflowState = {
  plans: Array<{ runId: string; plan: ExecutionPlan }>;
  workers: Array<{
    id: string;
    runId: string;
    taskKey: string;
    workerType: WorkerType;
    status: string;
    attempt: number;
    output: WorkerResult | null;
    error: string | null;
  }>;
  terminals: Array<{ runId: string; status: string; error: string | null }>;
};

const workflowGlobal = globalThis as typeof globalThis & {
  __businessOsWorkflowState?: MemoryWorkflowState;
};
const memory = workflowGlobal.__businessOsWorkflowState ??= {
  plans: [],
  workers: [],
  terminals: []
};

export async function persistWorkflowPlan(runId: string, plan: ExecutionPlan) {
  const run = await repository.getRun(runId);
  if (!run) throw new Error("Run not found.");
  const command = await repository.getCommand(run.commandId);
  const project = run.projectId ? await repository.getProject(run.projectId) : null;
  if (project?.budgetCents !== null && project?.budgetCents !== undefined &&
      plan.estimatedCostCents > project.budgetCents) {
    throw new Error("Plan exceeds project budget.");
  }
  const organizationLimit = Number(process.env.ORGANIZATION_BUDGET_CENTS ?? 0);
  if (organizationLimit > 0 && plan.estimatedCostCents > organizationLimit) {
    throw new Error("Plan exceeds organization budget.");
  }
  const agendaId = typeof command?.context.agendaId === "string" ? command.context.agendaId : null;
  const agendaLimit = typeof command?.context.agendaBudgetCents === "number"
    ? command.context.agendaBudgetCents
    : 0;
  if (agendaLimit > 0 && plan.estimatedCostCents > agendaLimit) {
    throw new Error("Plan exceeds agenda budget.");
  }

  if (!db) {
    const existing = memory.plans.find((item) => item.runId === runId);
    if (existing) existing.plan = plan;
    else memory.plans.push({ runId, plan });
    for (const task of plan.tasks) {
      if (!memory.workers.some((item) => item.runId === runId && item.taskKey === task.key)) {
        memory.workers.push({
          id: crypto.randomUUID(),
          runId,
          taskKey: task.key,
          workerType: task.workerType,
          status: "queued",
          attempt: 0,
          output: null,
          error: null
        });
      }
    }
    return memory.workers.filter((item) => item.runId === runId);
  }

  return db.transaction(async (tx) => {
    await tx.insert(workflowPlans).values({
      runId,
      plan,
      estimatedCostCents: plan.estimatedCostCents
    }).onConflictDoUpdate({
      target: [workflowPlans.runId, workflowPlans.revision],
      set: { plan, estimatedCostCents: plan.estimatedCostCents, updatedAt: new Date() }
    });
    await tx.insert(workflowStates).values({
      runId,
      status: "planning",
      checkpoint: { phase: "planned", taskCount: plan.tasks.length }
    }).onConflictDoUpdate({
      target: workflowStates.runId,
      set: {
        status: "planning",
        checkpoint: { phase: "planned", taskCount: plan.tasks.length },
        lastHeartbeatAt: new Date(),
        updatedAt: new Date()
      }
    });
    await tx.insert(budgetLedgers).values({
      organizationId: MTI_ORGANIZATION_ID,
      scopeType: "run",
      scopeId: runId,
      limitCents: plan.estimatedCostCents,
      reservedCents: plan.estimatedCostCents
    }).onConflictDoUpdate({
      target: [budgetLedgers.organizationId, budgetLedgers.scopeType, budgetLedgers.scopeId],
      set: { limitCents: plan.estimatedCostCents, reservedCents: plan.estimatedCostCents, updatedAt: new Date() }
    });
    const broaderLedgers = [
      organizationLimit > 0 ? { scopeType: "organization", scopeId: MTI_ORGANIZATION_ID, limitCents: organizationLimit } : null,
      project?.budgetCents ? { scopeType: "project", scopeId: project.id, limitCents: project.budgetCents } : null,
      agendaId && agendaLimit > 0 ? { scopeType: "agenda", scopeId: agendaId, limitCents: agendaLimit } : null
    ].filter((item): item is { scopeType: string; scopeId: string; limitCents: number } => Boolean(item));
    for (const ledger of broaderLedgers) {
      await tx.insert(budgetLedgers).values({
        organizationId: MTI_ORGANIZATION_ID,
        ...ledger,
        reservedCents: plan.estimatedCostCents
      }).onConflictDoUpdate({
        target: [budgetLedgers.organizationId, budgetLedgers.scopeType, budgetLedgers.scopeId],
        set: {
          limitCents: ledger.limitCents,
          reservedCents: plan.estimatedCostCents,
          updatedAt: new Date()
        }
      });
    }
    for (const task of plan.tasks) {
      await tx.insert(workerRuns).values({
        runId,
        taskKey: task.key,
        workerType: task.workerType,
        modelRoute: workerCatalog[task.workerType].modelRoute,
        input: task
      }).onConflictDoNothing();
    }
    return tx.select().from(workerRuns).where(eq(workerRuns.runId, runId));
  });
}

export async function registerWorkflowRun(runId: string, triggerRunId: string | null) {
  if (!db) return;
  await db.insert(workflowStates).values({
    runId,
    triggerRunId,
    status: "queued",
    checkpoint: { phase: "queued" }
  }).onConflictDoUpdate({
    target: workflowStates.runId,
    set: { triggerRunId, status: "queued", updatedAt: new Date() }
  });
}

export async function updateWorkflowCheckpoint(
  runId: string,
  status: string,
  checkpoint: Record<string, unknown>
) {
  if (!db) return;
  await db.insert(workflowStates).values({
    runId,
    status,
    checkpoint
  }).onConflictDoUpdate({
    target: workflowStates.runId,
    set: { status, checkpoint, lastHeartbeatAt: new Date(), updatedAt: new Date() }
  });
}

export async function markWorkerAttempt(
  runId: string,
  taskKey: string,
  attempt: number
) {
  await repository.appendEvent(runId, {
    type: "worker.attempt",
    message: `${taskKey} started attempt ${attempt}.`
  });
  if (!db) {
    const worker = memory.workers.find((item) => item.runId === runId && item.taskKey === taskKey);
    if (!worker) return null;
    worker.status = "executing";
    worker.attempt = Math.max(worker.attempt, attempt);
    return worker;
  }
  const [worker] = await db.update(workerRuns).set({
    status: "executing",
    attempt,
    startedAt: new Date(),
    updatedAt: new Date()
  }).where(and(eq(workerRuns.runId, runId), eq(workerRuns.taskKey, taskKey))).returning();
  return worker ?? null;
}

export async function persistWorkerResult(runId: string, result: WorkerResult) {
  await repository.appendEvent(runId, {
    type: "worker.completed",
    message: `${result.taskKey} completed with ${result.findings.length} findings.`
  });
  if (!db) {
    const worker = memory.workers.find((item) => item.runId === runId && item.taskKey === result.taskKey);
    if (!worker) return null;
    worker.status = "completed";
    worker.output = result;
    return worker;
  }
  const [worker] = await db.update(workerRuns).set({
    status: "completed",
    output: result,
    completedAt: new Date(),
    updatedAt: new Date()
  }).where(and(eq(workerRuns.runId, runId), eq(workerRuns.taskKey, result.taskKey))).returning();
  return worker ?? null;
}

export async function reconcileWorkflowTerminal(input: {
  runId: string;
  commandId: string;
  status: "completed" | "failed" | "cancelled";
  error?: string;
  payload?: Record<string, unknown>;
}) {
  if (db && input.status === "failed") {
    const [pendingPremium] = await db.select({ id: premiumModelApprovals.id })
      .from(premiumModelApprovals).where(and(
        eq(premiumModelApprovals.runId, input.runId),
        eq(premiumModelApprovals.status, "pending")
      )).limit(1);
    if (pendingPremium) return;
  }
  const commandStatus = input.status === "completed" ? "review_required" : input.status;
  await repository.updateCommand(input.commandId, { status: commandStatus });
  await repository.updateRun(input.runId, {
    status: commandStatus,
    progress: input.status === "completed" ? 100 : undefined
  });
  await repository.appendEvent(input.runId, {
    type: `run.${input.status}`,
    message: input.error ?? `Workflow ${input.status}.`
  });

  if (!db) {
    memory.terminals.push({ runId: input.runId, status: input.status, error: input.error ?? null });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.insert(workflowStates).values({
      runId: input.runId,
      status: input.status,
      terminalAt: new Date(),
      errorCode: input.status === "failed" ? "workflow_failed" : null,
      errorMessage: input.error ?? null
    }).onConflictDoUpdate({
      target: workflowStates.runId,
      set: {
        status: input.status,
        terminalAt: new Date(),
        errorCode: input.status === "failed" ? "workflow_failed" : null,
        errorMessage: input.error ?? null,
        updatedAt: new Date()
      }
    });
    if (input.status === "failed") {
      await tx.insert(deadLetters).values({
        runId: input.runId,
        category: "workflow_terminal_failure",
        error: input.error ?? "Workflow failed.",
        payload: input.payload ?? {}
      });
    }
  });
}
