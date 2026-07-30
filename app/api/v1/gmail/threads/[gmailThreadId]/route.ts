import { NextResponse } from "next/server";
import { retrieveGmailThread } from "@/lib/gmail";

import { guard } from "@/lib/api/guard";
export const GET = guard<{ gmailThreadId: string }>(async (request, { params }) => {
  const { gmailThreadId } = params;
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) return NextResponse.json({ error: "connectionId is required." }, { status: 400 });
  try {
    return NextResponse.json({
      data: await retrieveGmailThread({ connectionId, gmailThreadId })
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Gmail thread retrieval failed."
    }, { status: 502 });
  }
});
