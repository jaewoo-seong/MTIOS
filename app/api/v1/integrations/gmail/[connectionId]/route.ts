import { NextResponse } from "next/server";
import { disconnectGmail } from "@/lib/gmail";

import { guard } from "@/lib/api/guard";
export const DELETE = guard<{ connectionId: string }>(async (_request, { params }) => {
  const { connectionId } = params;
  try {
    return NextResponse.json({ data: await disconnectGmail(connectionId) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Gmail connection could not be removed."
    }, { status: 404 });
  }
}, { admin: true });
