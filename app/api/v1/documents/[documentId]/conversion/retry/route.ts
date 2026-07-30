import { NextResponse } from "next/server";
import { retryDocumentConversion } from "@/lib/documents/intelligence";

import { guard } from "@/lib/api/guard";
export const POST = guard<{ documentId: string }>(async (_request, { params }) => {
  const { documentId } = params;
  try {
    return NextResponse.json({ data: await retryDocumentConversion(documentId) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Document conversion retry failed."
    }, { status: 409 });
  }
});
