import { NextResponse } from "next/server";
import { disconnectGmail } from "@/lib/gmail";

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  const { connectionId } = await params;
  try {
    return NextResponse.json({ data: await disconnectGmail(connectionId) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Gmail connection could not be removed."
    }, { status: 404 });
  }
}
