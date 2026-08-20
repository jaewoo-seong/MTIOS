import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { listNotifications } from "@/lib/notifications";

export const GET = guard(async () => {
  return NextResponse.json({ data: await listNotifications() });
}, { admin: true });
