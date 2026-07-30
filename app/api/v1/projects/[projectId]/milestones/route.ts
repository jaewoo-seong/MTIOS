import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).default(""),
  dueAt: z.string().datetime().nullable().default(null)
});

export const POST = guard<{ projectId: string }>(async (request, { params }) => {
  const { projectId } = params;
  if (!await repository.getProject(projectId)) return notFound("project");
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await repository.createMilestone(projectId, {
      title: parsed.data.title,
      description: parsed.data.description ?? "",
      dueAt: parsed.data.dueAt ?? null
    })
  }, { status: 201 });
});
