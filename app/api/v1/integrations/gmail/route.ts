import { NextResponse } from "next/server";
import { listGmailConnections } from "@/lib/gmail";

import { guard } from "@/lib/api/guard";
export const GET = guard(async () => {
  return NextResponse.json({ data: await listGmailConnections() });
});
