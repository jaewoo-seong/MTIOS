import { NextResponse } from "next/server";
import { getClientChangeSet } from "@/lib/client-changes";

import { guard } from "@/lib/api/guard";
export const GET = guard<{ changeSetId: string }>(async (_request, { params }) => {
  const { changeSetId } = params;
  const changeSet = await getClientChangeSet(changeSetId);
  return changeSet
    ? NextResponse.json({ data: changeSet })
    : NextResponse.json({ error: "Change set not found." }, { status: 404 });
});
