import { task, tasks } from "@trigger.dev/sdk";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/client";
import {
  collectionCampaigns, collectionCandidateClaims, collectionCandidates,
  projectResearchSettings
} from "@/lib/db/schema";
import { repository } from "@/lib/repository";
import { callWorkflowApp } from "@/lib/workflows/callback";
import { dossierWorkerTask } from "@/trigger/collection-agent";

/**
 * A short-lived dispatcher enforces the project's current worker limit from
 * durable state. It never stays alive as an "agent"; each completed wave
 * schedules the next one, so changing the limit takes effect between claims.
 */
export async function runResearchProjectDispatcher(projectId: string) {
  const db = requireDatabase();
  const [settings] = await db.select().from(projectResearchSettings)
    .where(eq(projectResearchSettings.projectId, projectId)).limit(1);
  if (!settings || settings.researchPaused) return { status: "paused" as const };
  const [campaign] = await db.select().from(collectionCampaigns)
    .where(eq(collectionCampaigns.projectId, projectId)).orderBy(desc(collectionCampaigns.createdAt)).limit(1);
  if (!campaign) return { status: "waiting_for_campaign" as const };
  const active = await db.select({ id: collectionCandidateClaims.id }).from(collectionCandidateClaims).where(and(
    eq(collectionCandidateClaims.campaignId, campaign.id),
    isNull(collectionCandidateClaims.releasedAt),
    gt(collectionCandidateClaims.leaseExpiresAt, new Date())
  ));
  const available = Math.max(0, settings.dossierWorkerLimit - active.length);
  if (available === 0) return { status: "at_capacity" as const, active: active.length };
  const candidates = await db.select().from(collectionCandidates).where(and(
    eq(collectionCandidates.campaignId, campaign.id),
    eq(collectionCandidates.queueStatus, "queued"),
    eq(collectionCandidates.dossierStatus, "pending")
  )).orderBy(desc(collectionCandidates.priority), collectionCandidates.createdAt).limit(available);
  if (candidates.length === 0) {
    if (settings.discoveryEnabled) {
      await tasks.trigger("research-discovery-worker", { projectId, cyclesRemaining: 3 }, {
        idempotencyKey: `empty-queue-discovery:${projectId}:${Date.now()}`
      });
    }
    return { status: "queue_empty" as const };
  }

  const command = await repository.createCommand({
    page: "projects", projectId,
    instruction: `Research the next ${candidates.length} queued company dossier(s).`,
    context: { page: "projects", projectId, agendaId: campaign.agendaId }
  });
  await repository.updateCommand(command.id, { status: "executing", clarification: null });
  const run = await repository.createRun(command);
  await repository.updateRun(run.id, { status: "executing", progress: 10 });
  if (!campaign.agendaId) throw new Error("The research campaign has no agenda.");
  const agendaId = campaign.agendaId;

  const results = await dossierWorkerTask.batchTriggerAndWait(candidates.map((candidate) => ({
    payload: {
      runId: run.id, campaignId: campaign.id, projectId, agendaId,
      candidateId: candidate.id, candidateData: candidate.data,
      entitySchema: campaign.entitySchema, documentTemplate: campaign.documentTemplate,
      qualificationRules: campaign.qualificationRules
    },
    options: { idempotencyKey: `${run.id}:dossier:${candidate.id}` }
  })));
  await callWorkflowApp({ action: "cross_link", runId: run.id, campaignId: campaign.id });
  await repository.updateRun(run.id, { status: "completed", progress: 100 });
  await repository.updateCommand(command.id, { status: "completed" });

  const remaining = await db.select({ id: collectionCandidates.id }).from(collectionCandidates).where(and(
    eq(collectionCandidates.campaignId, campaign.id),
    eq(collectionCandidates.queueStatus, "queued"),
    eq(collectionCandidates.dossierStatus, "pending")
  )).limit(1);
  if (remaining.length > 0) {
    await tasks.trigger("research-project-dispatcher", { projectId }, {
      idempotencyKey: `research-refill:${projectId}:${run.id}`
    });
  } else if (settings.discoveryEnabled) {
    await tasks.trigger("research-discovery-worker", { projectId, cyclesRemaining: 3 }, {
      idempotencyKey: `post-wave-discovery:${projectId}:${run.id}`
    });
  }
  return { status: "completed" as const, dispatched: candidates.length, results: results.runs.length };
}

export const researchProjectDispatcher = task({
  id: "research-project-dispatcher",
  maxDuration: 7200,
  run: ({ projectId }: { projectId: string }) => runResearchProjectDispatcher(projectId)
});
