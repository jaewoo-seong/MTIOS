import { NextResponse } from "next/server";
import { z } from "zod";
import { decideClientChangeSet } from "@/lib/client-changes";
import { parseJson } from "@/lib/http";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  decision: z.enum(["approved", "rejected", "changes_requested", "needs_research"]),
  selectedItemIds: z.array(z.string().uuid()).max(1000).default([]),
  note: z.string().max(5000).default("")
});

export const POST = guard<{ changeSetId: string }>(async (request, { params }) => {
  const { changeSetId } = params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    return NextResponse.json({
      data: await decideClientChangeSet({ changeSetId, ...parsed.data })
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Decision could not be recorded."
    }, { status: 409 });
  }
});
