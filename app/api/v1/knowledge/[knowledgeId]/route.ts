import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  collection: z.string().trim().min(2).max(100).optional(),
  title: z.string().trim().min(2).max(180).optional(),
  content: z.string().trim().min(2).max(30000).optional(),
  source: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["proposed", "approved", "rejected"]).optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ knowledgeId: string }> }) {
  const { knowledgeId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const entry = await repository.updateKnowledge(knowledgeId, parsed.data);
  if (!entry) return notFound("knowledge");
  return NextResponse.json({ data: entry });
}
