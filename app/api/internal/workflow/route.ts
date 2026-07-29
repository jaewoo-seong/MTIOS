import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAgentContext } from "@/lib/ai/context";
import { parseJson } from "@/lib/http";
import { isValidWorkflowRequest } from "@/lib/internal-auth";
import { repository } from "@/lib/repository";
import {
  executionPlanSchema,
  workerResultSchema
} from "@/lib/workflows/contracts";
import {
  markWorkerAttempt,
  persistWorkerResult,
  persistWorkflowPlan,
  reconcileWorkflowTerminal,
  updateWorkflowCheckpoint
} from "@/lib/workflows/state";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("load"),
    commandId: z.string().uuid(),
    runId: z.string().uuid().optional()
  }),
  z.object({
    action: z.literal("progress"),
    commandId: z.string().uuid(),
    runId: z.string().uuid(),
    commandStatus: z.enum(["planning", "executing", "review_required", "completed", "failed"]).optional(),
    runStatus: z.enum(["planning", "executing", "review_required", "completed", "failed"]).optional(),
    progress: z.number().int().min(0).max(100).optional()
  }),
  z.object({
    action: z.literal("report"),
    commandId: z.string().uuid(),
    runId: z.string().uuid(),
    projectId: z.string().uuid().nullable(),
    title: z.string().min(1).max(180),
    summary: z.string().max(5000),
    content: z.string().min(1).max(200000)
  }),
  z.object({
    action: z.literal("plan"),
    runId: z.string().uuid(),
    plan: executionPlanSchema
  }),
  z.object({
    action: z.literal("worker_attempt"),
    runId: z.string().uuid(),
    taskKey: z.string().min(1).max(80),
    attempt: z.number().int().min(1).max(20)
  }),
  z.object({
    action: z.literal("worker_result"),
    runId: z.string().uuid(),
    result: workerResultSchema
  }),
  z.object({
    action: z.literal("terminal"),
    commandId: z.string().uuid(),
    runId: z.string().uuid(),
    status: z.enum(["completed", "failed", "cancelled"]),
    error: z.string().max(10000).optional(),
    payload: z.record(z.unknown()).optional()
  })
]);

export async function POST(request: Request) {
  if (!isValidWorkflowRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const input = parsed.data;

  if (input.action === "load") {
    const command = await repository.getCommand(input.commandId);
    if (!command) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({
      command,
      context: await buildAgentContext(command.projectId, command.instruction, {
        commandId: command.id,
        runId: input.runId ?? null
      })
    });
  }

  if (input.action === "progress") {
    if (input.commandStatus) {
      await repository.updateCommand(input.commandId, { status: input.commandStatus });
    }
    await repository.updateRun(input.runId, {
      status: input.runStatus,
      progress: input.progress
    });
    await updateWorkflowCheckpoint(
      input.runId,
      input.runStatus ?? input.commandStatus ?? "executing",
      { progress: input.progress ?? null }
    );
    const transition = input.runStatus ?? input.commandStatus;
    if (transition) {
      await repository.appendEvent(input.runId, {
        type: `run.${transition}`,
        message: `Workflow entered ${transition.replace("_", " ")} state.`
      });
    }
    return NextResponse.json({ status: "updated" });
  }

  if (input.action === "plan") {
    const workers = await persistWorkflowPlan(input.runId, executionPlanSchema.parse(input.plan));
    await repository.appendEvent(input.runId, {
      type: "run.planned",
      message: `Execution plan created with ${input.plan.tasks.length} delegated tasks.`
    });
    return NextResponse.json({ status: "planned", workers });
  }

  if (input.action === "worker_attempt") {
    const worker = await markWorkerAttempt(input.runId, input.taskKey, input.attempt);
    if (!worker) return NextResponse.json({ error: "worker_not_found" }, { status: 404 });
    return NextResponse.json({ status: "executing" });
  }

  if (input.action === "worker_result") {
    const worker = await persistWorkerResult(input.runId, workerResultSchema.parse(input.result));
    if (!worker) return NextResponse.json({ error: "worker_not_found" }, { status: 404 });
    return NextResponse.json({ status: "completed" });
  }

  if (input.action === "terminal") {
    await reconcileWorkflowTerminal(input);
    return NextResponse.json({ status: input.status });
  }

  const report = await repository.createReport({
    projectId: input.projectId,
    title: input.title,
    summary: input.summary,
    content: input.content
  });
  await repository.updateCommand(input.commandId, { status: "review_required" });
  await repository.updateRun(input.runId, { status: "review_required", progress: 100 });
  return NextResponse.json({ reportId: report.id, status: "review_required" }, { status: 201 });
}
