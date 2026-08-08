import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { updateCandidateControl } from "@/lib/research-workspace";

const schema = z.object({
  priority: z.number().int().min(-100).max(100).optional(),
  held: z.boolean().optional(),
  disposition: z.enum(["unreviewed", "approved", "declined", "needs_revision"]).optional()
}).refine((value) => Object.keys(value).length > 0, "At least one change is required.");

export const PATCH = guard<{ projectId: string; candidateId: string }>(async (request, { params }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const candidate = await updateCandidateControl(params.projectId, params.candidateId, parsed.data);
  return candidate
    ? NextResponse.json({ data: candidate })
    : NextResponse.json({ error: "Candidate not found." }, { status: 404 });
});
