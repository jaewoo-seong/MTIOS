import { NextResponse } from "next/server";
import { z } from "zod";
import { searchGmailThreads } from "@/lib/gmail";
import { parseJson } from "@/lib/http";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  connectionId: z.string().uuid(),
  query: z.string().trim().min(1).max(2000),
  maxResults: z.number().int().min(1).max(100).default(25)
});

export const POST = guard(async (request) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    return NextResponse.json({ data: await searchGmailThreads(parsed.data) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Gmail search failed."
    }, { status: 502 });
  }
});
