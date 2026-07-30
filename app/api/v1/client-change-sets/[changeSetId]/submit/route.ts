import { NextResponse } from "next/server";
import { submitClientChangeSet } from "@/lib/client-changes";

import { guard } from "@/lib/api/guard";
export const POST = guard<{ changeSetId: string }>(async (_request, { params }) => {
  const { changeSetId } = params;
  try {
    const changeSet = await submitClientChangeSet(changeSetId);
    return changeSet
      ? NextResponse.json({ data: changeSet })
      : NextResponse.json({ error: "Change set not found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Change set could not be submitted."
    }, { status: 409 });
  }
});
