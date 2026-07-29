import { NextResponse } from "next/server";
import { approveDocumentRevision } from "@/lib/documents/intelligence";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ documentId: string; revisionId: string }> }
) {
  const { documentId, revisionId } = await params;
  const revision = await approveDocumentRevision(documentId, revisionId);
  return revision
    ? NextResponse.json({ data: revision })
    : NextResponse.json({ error: "Document revision not found." }, { status: 404 });
}
