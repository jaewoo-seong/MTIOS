import { NextResponse } from "next/server";
import { rollbackClientChangeSet } from "@/lib/client-changes";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ changeSetId: string }> }
) {
  const { changeSetId } = await params;
  try {
    return NextResponse.json({ data: await rollbackClientChangeSet(changeSetId) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Change set could not be rolled back."
    }, { status: 409 });
  }
}
