import { NextResponse } from "next/server";
import { proposeAiDocumentRepair } from "@/lib/documents/intelligence";

import { guard } from "@/lib/api/guard";
export const POST = guard<{ documentId: string }>(async (_request, { params }) => {
  const { documentId } = params;
  try {
    return NextResponse.json({ data: await proposeAiDocumentRepair(documentId) }, { status: 202 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "AI document repair failed."
    }, { status: 409 });
  }
});
