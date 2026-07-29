import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAgentContext } from "@/lib/ai/context";
import { parseJson } from "@/lib/http";
import { isValidWorkflowRequest } from "@/lib/internal-auth";
import { repository } from "@/lib/repository";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("load"), commandId: z.string().uuid() }),
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
      context: await buildAgentContext(command.projectId)
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
    return NextResponse.json({ status: "updated" });
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
