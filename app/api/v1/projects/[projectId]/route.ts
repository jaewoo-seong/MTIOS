import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  objective: z.string().trim().min(10).max(4000).optional(),
  context: z.string().trim().max(6000).optional(),
  scope: z.string().trim().max(3000).optional(),
  constraints: z.array(z.string().trim().min(1).max(500)).optional(),
  budgetCents: z.number().int().nonnegative().nullable().optional(),
  reviewGates: z.array(z.string().trim().min(1).max(160)).optional(),
  outputRequirements: z.array(z.string().trim().min(1).max(300)).optional(),
  permissions: z.object({
    externalSend: z.enum(["review_required", "blocked"]),
    clientDataWrite: z.enum(["review_required", "blocked"]),
    destructiveAction: z.enum(["review_required", "blocked"])
  }).optional(),
  status: z.enum(["active", "paused", "completed", "archived"]).optional()
});

export async function GET(_: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await repository.getProject(projectId);
  if (!project) return notFound("project");
  return NextResponse.json({
    data: {
      ...project,
      agendas: await repository.listAgendas(projectId),
      milestones: await repository.listMilestones(projectId),
      records: await repository.listProjectRecords(projectId),
      deliverables: await repository.listDeliverables(projectId)
    }
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsed = await parseJson(request, updateProjectSchema);
  if (parsed.error) return parsed.error;
  const project = await repository.updateProject(projectId, parsed.data);
  if (!project) return notFound("project");
  return NextResponse.json({ data: project });
}
