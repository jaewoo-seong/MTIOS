import { NextResponse } from "next/server";
import { z } from "zod";
import { reviseGmailDraft } from "@/lib/gmail";
import { parseJson } from "@/lib/http";

import { guard } from "@/lib/api/guard";
const email = z.string().email().max(320);
const schema = z.object({
  to: z.array(email).min(1).max(100),
  cc: z.array(email).max(100).default([]),
  bcc: z.array(email).max(100).default([]),
  subject: z.string().max(998),
  bodyText: z.string().max(500000)
});

export const PATCH = guard<{ draftId: string }>(async (request, { params }) => {
  const { draftId } = params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    return NextResponse.json({ data: await reviseGmailDraft({ draftId, ...parsed.data }) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Gmail draft could not be revised."
    }, { status: 502 });
  }
});
