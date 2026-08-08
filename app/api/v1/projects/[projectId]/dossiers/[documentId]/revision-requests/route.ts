import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { createDossierRevisionRequest } from "@/lib/research-workspace";
import { dispatchDossierRevision } from "@/lib/workflows/trigger";

const schema = z.object({
  instruction: z.string().trim().min(2).max(12000),
  questions: z.array(z.string().trim().min(1).max(2000)).max(30).default([]),
  attachmentDocumentIds: z.array(z.string().uuid()).max(20).default([])
});

export const POST = guard<{ projectId: string; documentId: string }>(async (request, { params, session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const revision = await createDossierRevisionRequest({
    projectId: params.projectId, documentId: params.documentId, userId: session.userId,
    instruction: parsed.data.instruction, questions: parsed.data.questions,
    attachmentDocumentIds: parsed.data.attachmentDocumentIds
  });
  if (!revision) return NextResponse.json({ error: "Dossier not found." }, { status: 404 });
  const dispatch = await dispatchDossierRevision(revision.id);
  return NextResponse.json({ data: { ...revision, dispatch } }, { status: 201 });
}, { rateLimit: "expensive" });
