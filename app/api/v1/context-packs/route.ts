import { NextResponse } from "next/server";
import { z } from "zod";
import { buildContextPack } from "@/lib/context/retrieval";
import { parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  query: z.string().trim().min(2).max(12000),
  projectId: z.string().uuid().nullable().default(null),
  agendaId: z.string().uuid().nullable().default(null),
  taskId: z.string().uuid().nullable().default(null),
  runId: z.string().uuid().nullable().default(null),
  commandId: z.string().uuid().nullable().default(null),
  tokenBudget: z.number().int().min(500).max(32000).default(8000)
});

export const POST = guard(async (request) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  if (parsed.data.projectId && !await repository.getProject(parsed.data.projectId)) {
    return NextResponse.json({ error: "project_not_found" }, { status: 404 });
  }
  return NextResponse.json({
    data: await buildContextPack({
      query: parsed.data.query,
      projectId: parsed.data.projectId ?? null,
      agendaId: parsed.data.agendaId ?? null,
      taskId: parsed.data.taskId ?? null,
      runId: parsed.data.runId ?? null,
      commandId: parsed.data.commandId ?? null,
      tokenBudget: parsed.data.tokenBudget ?? 8000
    })
  }, { status: 201 });
});
