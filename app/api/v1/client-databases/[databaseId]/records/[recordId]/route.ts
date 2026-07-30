import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";

export const DELETE = guard<{ recordId: string }>(async (_request, { params }) => {
  void params;
  return NextResponse.json({
    error: "Direct client-record deletion is disabled. Create and approve a client change set."
  }, { status: 405 });
});
