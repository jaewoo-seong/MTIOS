import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  agendaId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(2).max(200),
  type: z.string().trim().min(2).max(80).default("report"),
  reviewRequired: z.boolean().default(false)
});

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!await repository.getProject(projectId)) return notFound("project");
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  if (parsed.data.agendaId) {
    const agenda = await repository.getAgenda(parsed.data.agendaId);
    if (!agenda || agenda.projectId !== projectId) return notFound("agenda");
  }
  return NextResponse.json({
    data: await repository.createDeliverable(projectId, {
      agendaId: parsed.data.agendaId ?? null,
      title: parsed.data.title,
      type: parsed.data.type ?? "report",
      reviewRequired: parsed.data.reviewRequired ?? false
    })
  }, { status: 201 });
}
