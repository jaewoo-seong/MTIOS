import { NextResponse } from "next/server";

export async function DELETE(_: Request, { params }: { params: Promise<{ recordId: string }> }) {
  void await params;
  return NextResponse.json({
    error: "Direct client-record deletion is disabled. Create and approve a client change set."
  }, { status: 405 });
}
