import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { runResearchQuery } from "@/lib/research/engine";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  projectId: z.string().uuid(),
  agendaId: z.string().uuid(),
  runId: z.string().uuid().nullable().optional(),
  query: z.string().trim().min(2).max(2000),
  category: z.enum(["web", "company", "government", "economic", "korean", "academic", "reference"]),
  language: z.string().trim().min(2).max(10).default("en"),
  queryBudget: z.number().int().min(1).max(100).default(10),
  maxResults: z.number().int().min(1).max(100).default(20)
});

export const POST = guard(async (request) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const project = await repository.getProject(parsed.data.projectId);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const agendas = await repository.listAgendas(project.id);
  if (!agendas.some((agenda) => agenda.id === parsed.data.agendaId)) {
    return NextResponse.json({ error: "Agenda not found in project." }, { status: 404 });
  }
  const result = await runResearchQuery(parsed.data);
  return NextResponse.json({ data: result }, { status: result.evidence.length > 0 ? 200 : 206 });
});
