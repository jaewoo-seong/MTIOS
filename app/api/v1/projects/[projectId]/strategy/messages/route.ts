import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { proposeResearchStrategy } from "@/lib/research-workspace";

const schema = z.object({
  instruction: z.string().trim().min(2).max(12000),
  attachmentDocumentIds: z.array(z.string().uuid()).max(20).default([])
});

export const POST = guard<{ projectId: string }>(async (request, { params, session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    const result = await proposeResearchStrategy({
      projectId: params.projectId, userId: session.userId,
      instruction: parsed.data.instruction,
      attachmentDocumentIds: parsed.data.attachmentDocumentIds
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "The strategist could not respond."
    }, { status: 422 });
  }
}, { rateLimit: "expensive" });
