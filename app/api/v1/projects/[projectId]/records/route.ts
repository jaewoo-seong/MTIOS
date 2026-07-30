import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  agendaId: z.string().uuid().nullable().default(null),
  kind: z.enum(["decision", "assumption", "question"]),
  content: z.string().trim().min(2).max(4000)
});

export const POST = guard<{ projectId: string }>(async (request, { params }) => {
  const { projectId } = params;
  if (!await repository.getProject(projectId)) return notFound("project");
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  if (parsed.data.agendaId) {
    const agenda = await repository.getAgenda(parsed.data.agendaId);
    if (!agenda || agenda.projectId !== projectId) return notFound("agenda");
  }
  return NextResponse.json({
    data: await repository.createProjectRecord(projectId, {
      agendaId: parsed.data.agendaId ?? null,
      kind: parsed.data.kind,
      content: parsed.data.content
    })
  }, { status: 201 });
});
