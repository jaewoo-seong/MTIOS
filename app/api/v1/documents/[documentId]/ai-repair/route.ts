import { NextResponse } from "next/server";
import { proposeAiDocumentRepair } from "@/lib/documents/intelligence";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
  try {
    return NextResponse.json({ data: await proposeAiDocumentRepair(documentId) }, { status: 202 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "AI document repair failed."
    }, { status: 409 });
  }
}
