import { NextResponse } from "next/server";
import { getClientChangeSet } from "@/lib/client-changes";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ changeSetId: string }> }
) {
  const { changeSetId } = await params;
  const changeSet = await getClientChangeSet(changeSetId);
  return changeSet
    ? NextResponse.json({ data: changeSet })
    : NextResponse.json({ error: "Change set not found." }, { status: 404 });
}
