import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { setGmailServiceSender } from "@/lib/gmail";
import { parseJson } from "@/lib/http";

const schema = z.object({ connectionId: z.string().uuid() });

export const POST = guard(async (request, { session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await setGmailServiceSender(parsed.data.connectionId, session.userId)
  });
}, { admin: true });
