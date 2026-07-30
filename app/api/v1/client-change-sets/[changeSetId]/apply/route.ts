import { NextResponse } from "next/server";
import { z } from "zod";
import { applyClientChangeSet } from "@/lib/client-changes";
import { parseJson } from "@/lib/http";

import { guard } from "@/lib/api/guard";
const schema = z.object({ approvalToken: z.string().min(20).max(500) });

export const POST = guard<{ changeSetId: string }>(async (request, { params }) => {
  const { changeSetId } = params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    const application = await applyClientChangeSet(changeSetId, parsed.data.approvalToken);
    return NextResponse.json({ data: application }, {
      status: application.status === "conflict" ? 409 : 200
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Change set could not be applied."
    }, { status: 409 });
  }
});
