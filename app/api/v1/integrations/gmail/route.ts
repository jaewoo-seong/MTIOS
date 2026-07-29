import { NextResponse } from "next/server";
import { listGmailConnections } from "@/lib/gmail";

export async function GET() {
  return NextResponse.json({ data: await listGmailConnections() });
}
