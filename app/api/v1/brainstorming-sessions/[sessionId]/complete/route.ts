import { NextResponse } from "next/server";
import { z } from "zod";
import { completeBrainstormingSession } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

const schema = z.object({
  decisionSummary: z.string().trim().min(1).max(20000)
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const session = await completeBrainstormingSession(sessionId, parsed.data.decisionSummary);
  return session
    ? NextResponse.json({ data: session })
    : NextResponse.json({ error: "Brainstorming session not found." }, { status: 404 });
}
