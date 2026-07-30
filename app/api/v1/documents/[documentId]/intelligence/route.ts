import { NextResponse } from "next/server";
import { getDocumentIntelligence } from "@/lib/documents/intelligence";

import { guard } from "@/lib/api/guard";
export const GET = guard<{ documentId: string }>(async (_request, { params }) => {
  const { documentId } = params;
  const detail = await getDocumentIntelligence(documentId);
  return detail
    ? NextResponse.json({ data: detail })
    : NextResponse.json({ error: "Document not found." }, { status: 404 });
});
