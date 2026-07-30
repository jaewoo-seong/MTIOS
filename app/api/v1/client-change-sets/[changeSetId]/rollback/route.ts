import { NextResponse } from "next/server";
import { rollbackClientChangeSet } from "@/lib/client-changes";

import { guard } from "@/lib/api/guard";
export const POST = guard<{ changeSetId: string }>(async (_request, { params }) => {
  const { changeSetId } = params;
  try {
    return NextResponse.json({ data: await rollbackClientChangeSet(changeSetId) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Change set could not be rolled back."
    }, { status: 409 });
  }
});
