import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  title: z.string().trim().min(2).max(160),
  instruction: z.string().trim().min(5).max(6000)
});

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!await repository.getProject(projectId)) return notFound("project");
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({ data: await repository.createAgenda(projectId, parsed.data) }, { status: 201 });
}
