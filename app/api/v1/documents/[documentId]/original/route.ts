import { NextResponse } from "next/server";
import { getOriginalDocumentUrl } from "@/lib/documents/intelligence";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
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
}
