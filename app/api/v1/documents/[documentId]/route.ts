import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { recordDocumentRevision } from "@/lib/documents/intelligence";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
const updateDocumentSchema = z.object({
  folderId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  projectId: z.string().min(1).nullable().optional(),
  markdown: z.string().max(400_000).optional()
});

export const GET = guard<{ documentId: string }>(async (_request, { params }) => {
  const { documentId } = params;
  const document = await repository.getDocument(documentId);
  if (!document) return notFound("document");
  return NextResponse.json({ data: document });
});

export const PATCH = guard<{ documentId: string }>(async (request, { params }) => {
  const { documentId } = params;
  const parsed = await parseJson(request, updateDocumentSchema);
  if (parsed.error) return parsed.error;

  if (parsed.data.folderId) {
    const folders = await repository.listFolders();
    if (!folders.some((folder) => folder.id === parsed.data.folderId)) {
      return notFound("folder");
    }
  }

  const document = await repository.updateDocument(documentId, parsed.data);
  if (!document) return notFound("document");
  // Editing the body changes the word count the list and preview display.
  if (parsed.data.markdown !== undefined) {
    await recordDocumentRevision({
      documentId,
      markdown: parsed.data.markdown,
      source: "manual",
      approved: true
    });
    const updated = await repository.getDocument(documentId);
    return NextResponse.json({ data: updated });
  }
  return NextResponse.json({ data: document });
});

export const DELETE = guard<{ documentId: string }>(async (_request, { params }) => {
  const { documentId } = params;
  const deleted = await repository.deleteDocument(documentId);
  if (!deleted) return notFound("document");
  return new NextResponse(null, { status: 204 });
});
