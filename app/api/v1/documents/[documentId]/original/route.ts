import { NextResponse } from "next/server";
import { getOriginalDocumentUrl } from "@/lib/documents/intelligence";

import { guard } from "@/lib/api/guard";
export const GET = guard<{ documentId: string }>(async (_request, { params }) => {
  const { documentId } = params;
  try {
    const original = await getOriginalDocumentUrl(documentId);
    return original
      ? NextResponse.json({ data: original })
      : NextResponse.json({ error: "Document not found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Original file is unavailable."
    }, { status: 409 });
  }
});
