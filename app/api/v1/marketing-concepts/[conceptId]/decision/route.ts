import { NextResponse } from "next/server";
import { z } from "zod";
import { decideMarketingConcept } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

const schema = z.object({
  status: z.enum(["shortlisted", "approved", "rejected"]),
  decisionReason: z.string().trim().min(1).max(5000)
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conceptId: string }> }
) {
  const { conceptId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const concept = await decideMarketingConcept(
    conceptId,
    parsed.data.status,
    parsed.data.decisionReason
  );
  return concept
    ? NextResponse.json({ data: concept })
    : NextResponse.json({ error: "Marketing concept not found." }, { status: 404 });
}
