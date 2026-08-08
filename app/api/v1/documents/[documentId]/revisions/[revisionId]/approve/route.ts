import { NextResponse } from "next/server";
import { approveDocumentRevision } from "@/lib/documents/intelligence";

import { guard } from "@/lib/api/guard";
export const POST = guard<{ documentId: string; revisionId: string }>(async (_request, { params }) => {
  const { documentId, revisionId } = params;
  try {
    const revision = await approveDocumentRevision(documentId, revisionId);
    return revision
      ? NextResponse.json({ data: revision })
      : NextResponse.json({ error: "Document revision not found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "This revision could not be accepted."
    }, { status: 409 });
  }
});
