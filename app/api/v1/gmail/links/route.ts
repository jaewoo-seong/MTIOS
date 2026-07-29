import { NextResponse } from "next/server";
import { z } from "zod";
import { linkGmailToProject } from "@/lib/gmail";
import { parseJson } from "@/lib/http";

const schema = z.object({
  projectId: z.string().uuid(),
  threadId: z.string().uuid().nullable().optional(),
  messageId: z.string().uuid().nullable().optional(),
  clientRecordId: z.string().uuid().nullable().optional(),
  companyId: z.string().uuid().nullable().optional()
}).refine((value) => value.threadId || value.messageId, {
  message: "threadId or messageId is required."
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    return NextResponse.json({ data: await linkGmailToProject(parsed.data) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Gmail link could not be created."
    }, { status: 400 });
  }
}
