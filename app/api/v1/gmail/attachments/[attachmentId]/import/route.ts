import { NextResponse } from "next/server";
import { z } from "zod";
import { importGmailAttachment } from "@/lib/gmail";
import { parseJson } from "@/lib/http";

const schema = z.object({ projectId: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  const { attachmentId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    return NextResponse.json({
      data: await importGmailAttachment({ attachmentId, projectId: parsed.data.projectId })
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Gmail attachment import failed."
    }, { status: 502 });
  }
}
