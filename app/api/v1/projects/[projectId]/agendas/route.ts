import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";
import { currentSession } from "@/lib/auth";

const schema = z.object({
  title: z.string().trim().min(2).max(160),
  instruction: z.string().trim().min(5).max(6000),
  workType: z.enum([
    "research", "marketing", "brainstorming", "content", "data_enrichment",
    "document", "communication", "analysis", "operations", "custom"
  ]).default("custom")
});

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const actor = await currentSession();
  const { projectId } = await params;
  if (!await repository.getProject(projectId)) return notFound("project");
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({ data: await repository.createAgenda(projectId, parsed.data, actor.userId) }, { status: 201 });
}
