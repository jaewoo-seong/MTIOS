import { NextResponse } from "next/server";
import { z } from "zod";
import { addBrainstormingIdea } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

const schema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10000).default(""),
  scores: z.record(z.string(), z.number().min(0).max(100)).default({}),
  position: z.number().int().min(0).default(0)
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await addBrainstormingIdea(sessionId, parsed.data)
  }, { status: 201 });
}
