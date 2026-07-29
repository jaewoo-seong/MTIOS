import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(4000).default(""),
  assignedAgentId: z.string().uuid().nullable().default(null),
  dependsOn: z.array(z.string().uuid()).default([]),
  toolScopes: z.array(z.string().trim().min(1).max(120)).default([]),
  outputSchema: z.record(z.unknown()).default({}),
  budgetCents: z.number().int().nonnegative().nullable().default(null),
  reviewRequired: z.boolean().default(false)
});

export async function GET(_: Request, { params }: { params: Promise<{ agendaId: string }> }) {
  const { agendaId } = await params;
  if (!await repository.getAgenda(agendaId)) return notFound("agenda");
  return NextResponse.json({ data: await repository.listTasks(agendaId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ agendaId: string }> }) {
  const { agendaId } = await params;
  if (!await repository.getAgenda(agendaId)) return notFound("agenda");
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await repository.createTask(agendaId, {
      title: parsed.data.title,
      description: parsed.data.description ?? "",
      assignedAgentId: parsed.data.assignedAgentId ?? null,
      dependsOn: parsed.data.dependsOn ?? [],
      toolScopes: parsed.data.toolScopes ?? [],
      outputSchema: parsed.data.outputSchema ?? {},
      budgetCents: parsed.data.budgetCents ?? null,
      reviewRequired: parsed.data.reviewRequired ?? false
    })
  }, { status: 201 });
}
