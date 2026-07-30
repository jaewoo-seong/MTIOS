import { NextResponse } from "next/server";
import { z } from "zod";
import { flagResearchContradiction } from "@/lib/research/engine";
import { parseJson } from "@/lib/http";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  claimKey: z.string().trim().min(1).max(500),
  evidenceIds: z.array(z.string().uuid()).min(2).max(100),
  description: z.string().trim().min(2).max(10000)
});

export const POST = guard<{ queryId: string }>(async (request, { params }) => {
  const { queryId } = params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await flagResearchContradiction({ queryId, ...parsed.data })
  }, { status: 201 });
});
