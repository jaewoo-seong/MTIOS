import { NextResponse } from "next/server";
import { getDocumentIntelligence } from "@/lib/documents/intelligence";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
  const detail = await getDocumentIntelligence(documentId);
  return detail
    ? NextResponse.json({ data: detail })
    : NextResponse.json({ error: "Document not found." }, { status: 404 });
}
