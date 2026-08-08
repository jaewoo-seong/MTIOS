import { task, tasks } from "@trigger.dev/sdk";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requestModel } from "@/lib/ai/litellm";
import { parseModelJson } from "@/lib/ai/model-json";
import { requireDatabase } from "@/lib/db/client";
import {
  agendas, dossierRevisionRequests, documentRevisions, documents,
  projectResearchSettings, projectStrategyVersions
} from "@/lib/db/schema";
import { recordDocumentRevision } from "@/lib/documents/intelligence";
import { runResearchQuery } from "@/lib/research/engine";

const queryPlan = z.object({ queries: z.array(z.string().trim().min(2).max(1000)).max(4) });

function text(response: unknown) {
  const value = (response as { choices?: Array<{ message?: { content?: string | null } }> })
    ?.choices?.[0]?.message?.content;
  if (!value) throw new Error("The revision model returned no content.");
  return value;
}

export async function runDossierRevision(requestId: string) {
  const db = requireDatabase();
  const [queued] = await db.select().from(dossierRevisionRequests).where(and(
    eq(dossierRevisionRequests.id, requestId), eq(dossierRevisionRequests.status, "queued")
  )).limit(1);
  if (!queued) return { status: "skipped" as const };
  const request = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dossier-revisions:${queued.projectId}`}))`);
    const [settings] = await tx.select().from(projectResearchSettings)
      .where(eq(projectResearchSettings.projectId, queued.projectId)).limit(1);
    const [{ value: working }] = await tx.select({ value: count() }).from(dossierRevisionRequests).where(and(
      eq(dossierRevisionRequests.projectId, queued.projectId),
      eq(dossierRevisionRequests.status, "working")
    ));
    if (Number(working) >= (settings?.revisionWorkerLimit ?? 2)) return null;
    const [claimed] = await tx.update(dossierRevisionRequests).set({ status: "working", updatedAt: new Date() })
      .where(and(eq(dossierRevisionRequests.id, requestId), eq(dossierRevisionRequests.status, "queued"))).returning();
    return claimed ?? null;
  });
  if (!request) return { status: "at_capacity" as const };
  try {
    const [document] = await db.select().from(documents).where(eq(documents.id, request.documentId)).limit(1);
    if (!document) throw new Error("Dossier document not found.");
    const [base] = await db.select().from(documentRevisions).where(and(
      eq(documentRevisions.documentId, document.id), eq(documentRevisions.revision, request.baseRevision)
    )).limit(1);
    const [settings] = await db.select().from(projectResearchSettings)
      .where(eq(projectResearchSettings.projectId, request.projectId)).limit(1);
    const [strategy] = settings?.activeStrategyVersionId
      ? await db.select().from(projectStrategyVersions).where(eq(projectStrategyVersions.id, settings.activeStrategyVersionId)).limit(1)
      : [null];
    const attachments = request.attachmentDocumentIds.length === 0 ? [] : await db.select({
      id: documents.id, title: documents.title, markdown: documents.markdown
    }).from(documents);
    const relevantAttachments = attachments.filter((item) => request.attachmentDocumentIds.includes(item.id));
    const planResponse = await requestModel("worker_structured", [
      { role: "system", content: 'Plan zero to four web searches needed to satisfy this dossier revision. Return JSON only: {"queries":["string"]}. Return an empty list when editing alone is sufficient.' },
      { role: "user", content: JSON.stringify({ title: document.title, instruction: request.instruction, questions: request.questions }) }
    ], { structuredOutput: true });
    const planned = queryPlan.parse(parseModelJson(text(planResponse)));
    let [agenda] = await db.select().from(agendas).where(eq(agendas.projectId, request.projectId))
      .orderBy(desc(agendas.createdAt)).limit(1);
    if (!agenda) {
      [agenda] = await db.insert(agendas).values({
        projectId: request.projectId, title: `Dossier revision: ${document.title}`,
        instruction: request.instruction, workType: "research", createdBy: request.createdBy
      }).returning();
    }
    const evidence = [];
    for (const query of planned.queries) {
      const result = await runResearchQuery({
        projectId: request.projectId, agendaId: agenda.id, query, category: "web",
        language: "en", queryBudget: 2, maxResults: 8
      });
      evidence.push(...result.evidence);
    }
    const revised = await requestModel("worker_editing", [
      {
        role: "system",
        content: [
          "Revise one master company dossier in Markdown.",
          "Return the complete revised document, not a patch or commentary.",
          "Preserve supported content unless the operator asks to change it.",
          "Use supplied evidence for new factual claims and retain source URLs.",
          "Clearly label inference, sales hypotheses, unknowns, and conflicting evidence.",
          "Never invent people, contact information, company facts, or citations."
        ].join("\n")
      },
      { role: "user", content: JSON.stringify({
        instruction: request.instruction, questions: request.questions,
        baseDocument: base?.markdown ?? document.markdown,
        activeStrategy: strategy?.strategy ?? null,
        attachments: relevantAttachments,
        newEvidence: evidence
      }) }
    ]);
    const markdown = text(revised).trim();
    const revision = await recordDocumentRevision({
      documentId: document.id, markdown, source: "agent_rework", approved: false,
      baseRevision: request.baseRevision, feedbackRequestId: request.id,
      strategyVersionId: strategy?.id ?? null,
      changeSummary: request.instruction.slice(0, 1000)
    });
    await db.update(dossierRevisionRequests).set({
      status: "completed", outputRevisionId: revision.id, completedAt: new Date(), updatedAt: new Date()
    }).where(eq(dossierRevisionRequests.id, request.id));
    await triggerNextRevision(request.projectId);
    return { status: "completed" as const, revisionId: revision.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dossier revision failed.";
    await db.update(dossierRevisionRequests).set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(dossierRevisionRequests.id, request.id));
    await triggerNextRevision(request.projectId);
    throw error;
  }
}

async function triggerNextRevision(projectId: string) {
  const db = requireDatabase();
  const [next] = await db.select({ id: dossierRevisionRequests.id }).from(dossierRevisionRequests).where(and(
    eq(dossierRevisionRequests.projectId, projectId),
    eq(dossierRevisionRequests.status, "queued")
  )).orderBy(dossierRevisionRequests.createdAt).limit(1);
  if (!next) return;
  await tasks.trigger("dossier-revision-worker", { requestId: next.id }, {
    idempotencyKey: `dossier-revision-pump:${next.id}:${Date.now()}`
  });
}

export const dossierRevisionWorker = task({
  id: "dossier-revision-worker",
  queue: { concurrencyLimit: 10 },
  maxDuration: 1800,
  run: ({ requestId }: { requestId: string }) => runDossierRevision(requestId)
});
