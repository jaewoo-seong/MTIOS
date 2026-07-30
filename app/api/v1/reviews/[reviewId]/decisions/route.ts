import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

const schema = z.object({
  decision: z.enum(["approved", "rejected", "changes_requested"]),
  note: z.string().trim().max(5000).default("")
});

export const POST = guard<{ reviewId: string }>(async (request, { params, session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const decision = await repository.createReviewDecision(params.reviewId, {
    decision: parsed.data.decision,
    note: parsed.data.note ?? ""
  }, session.userId);
  return NextResponse.json({ data: decision }, { status: 201 });
});
