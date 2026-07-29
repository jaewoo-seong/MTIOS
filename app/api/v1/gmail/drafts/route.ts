import { NextResponse } from "next/server";
import { z } from "zod";
import { createGmailDraft } from "@/lib/gmail";
import { parseJson } from "@/lib/http";

const email = z.string().email().max(320);
const schema = z.object({
  connectionId: z.string().uuid(),
  projectId: z.string().uuid(),
  threadId: z.string().uuid().nullable().optional(),
  to: z.array(email).min(1).max(100),
  cc: z.array(email).max(100).default([]),
  bcc: z.array(email).max(100).default([]),
  subject: z.string().max(998),
  bodyText: z.string().max(500000)
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    return NextResponse.json({ data: await createGmailDraft(parsed.data) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Gmail draft could not be created."
    }, { status: 502 });
  }
}
