import { NextResponse } from "next/server";
import { retryDocumentConversion } from "@/lib/documents/intelligence";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
  try {
    return NextResponse.json({ data: await retryDocumentConversion(documentId) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Document conversion retry failed."
    }, { status: 409 });
  }
}
