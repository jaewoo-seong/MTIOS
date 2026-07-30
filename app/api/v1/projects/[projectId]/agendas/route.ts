import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  title: z.string().trim().min(2).max(160),
  instruction: z.string().trim().min(5).max(6000),
  workType: z.enum([
    "research", "marketing", "brainstorming", "content", "data_enrichment",
    "document", "communication", "analysis", "operations", "custom"
  ]).default("custom")
});

export const POST = guard<{ projectId: string }>(async (request, { params, session }) => {
  if (!await repository.getProject(params.projectId)) return notFound("project");
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await repository.createAgenda(params.projectId, parsed.data, session.userId)
  }, { status: 201 });
});
