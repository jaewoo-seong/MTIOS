import { NextResponse } from "next/server";
import { z } from "zod";
import { decideBrainstormingIdea } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

const schema = z.object({
  status: z.enum(["shortlisted", "selected", "rejected"]),
  decisionReason: z.string().trim().min(1).max(5000)
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ideaId: string }> }
) {
  const { ideaId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const idea = await decideBrainstormingIdea(
    ideaId,
    parsed.data.status,
    parsed.data.decisionReason
  );
  return idea
    ? NextResponse.json({ data: idea })
    : NextResponse.json({ error: "Brainstorming idea not found." }, { status: 404 });
}
