import { NextResponse } from "next/server";
import { createGmailAuthorization } from "@/lib/gmail";

export async function POST() {
  try {
    return NextResponse.json({ data: await createGmailAuthorization({}) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Gmail authorization could not start."
    }, { status: 503 });
  }
}
