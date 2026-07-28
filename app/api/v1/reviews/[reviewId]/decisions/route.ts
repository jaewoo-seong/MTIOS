import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  decision: z.enum(["approved", "rejected", "changes_requested"]),
  note: z.string().trim().max(5000).default("")
});

export async function POST(request: Request, { params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const decision = await repository.createReviewDecision(reviewId, {
    decision: parsed.data.decision,
    note: parsed.data.note ?? ""
  });
  return NextResponse.json({ data: decision }, { status: 201 });
}
