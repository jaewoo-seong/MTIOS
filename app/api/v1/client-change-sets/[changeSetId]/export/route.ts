import { NextResponse } from "next/server";
import { getClientChangeSet } from "@/lib/client-changes";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ changeSetId: string }> }
) {
  const { changeSetId } = await params;
  const changeSet = await getClientChangeSet(changeSetId);
  if (!changeSet) return NextResponse.json({ error: "Change set not found." }, { status: 404 });
  return new NextResponse(JSON.stringify(changeSet, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="client-change-set-${changeSetId}.json"`
    }
  });
}
