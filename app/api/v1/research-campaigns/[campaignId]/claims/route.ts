import { NextResponse } from "next/server";
import { z } from "zod";
import { claimCandidate, releaseCandidateClaim } from "@/lib/company-research";
import { parseJson } from "@/lib/http";

import { guard } from "@/lib/api/guard";
const claimSchema = z.object({
  candidateId: z.string().uuid(),
  workerRunId: z.string().uuid().nullable().optional(),
  leaseSeconds: z.number().int().min(30).max(3600).default(300)
});
const releaseSchema = z.object({
  candidateId: z.string().uuid(),
  leaseToken: z.string().uuid()
});

export const POST = guard<{ campaignId: string }>(async (request, { params }) => {
  const { campaignId } = params;
  const parsed = await parseJson(request, claimSchema);
  if (parsed.error) return parsed.error;
  const claim = await claimCandidate({ campaignId, ...parsed.data });
  return claim
    ? NextResponse.json({ data: claim }, { status: 201 })
    : NextResponse.json({ error: "Candidate already has an active lease." }, { status: 409 });
});

export const DELETE = guard<{ campaignId: string }>(async (request, { params }) => {
  const { campaignId } = params;
  const parsed = await parseJson(request, releaseSchema);
  if (parsed.error) return parsed.error;
  const released = await releaseCandidateClaim(
    campaignId,
    parsed.data.candidateId,
    parsed.data.leaseToken
  );
  return released
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "Active lease not found." }, { status: 404 });
});
