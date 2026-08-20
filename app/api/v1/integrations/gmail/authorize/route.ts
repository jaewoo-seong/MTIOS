import { NextResponse } from "next/server";
import { createGmailAuthorization } from "@/lib/gmail";

import { guard } from "@/lib/api/guard";
export const POST = guard(async (_request, { session }) => {
  try {
    return NextResponse.json({ data: await createGmailAuthorization({ userId: session.userId }) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Gmail authorization could not start."
    }, { status: 503 });
  }
}, { admin: true });
