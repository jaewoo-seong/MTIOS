import { NextResponse } from "next/server";
import { submitClientChangeSet } from "@/lib/client-changes";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ changeSetId: string }> }
) {
  const { changeSetId } = await params;
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
}
