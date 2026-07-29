import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).default(""),
  dueAt: z.string().datetime().nullable().default(null)
});

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
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
}
