import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/client";
import {
  collectionCampaigns,
  collectionCandidates,
  dossierContextSnapshots,
  projectResearchSettings,
  projects,
  projectStrategyVersions
} from "@/lib/db/schema";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";

export async function createDossierContextSnapshot(input: {
  projectId: string;
  campaignId: string;
  candidateId: string;
  runId: string;
}) {
  const db = requireDatabase();
  const [project, campaign, candidate, settings] = await Promise.all([
    db.select().from(projects).where(and(
      eq(projects.id, input.projectId), eq(projects.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1).then((rows) => rows[0]),
    db.select().from(collectionCampaigns).where(eq(collectionCampaigns.id, input.campaignId)).limit(1).then((rows) => rows[0]),
    db.select().from(collectionCandidates).where(eq(collectionCandidates.id, input.candidateId)).limit(1).then((rows) => rows[0]),
    db.select().from(projectResearchSettings).where(eq(projectResearchSettings.projectId, input.projectId)).limit(1).then((rows) => rows[0])
  ]);
  if (!project || !campaign || !candidate) throw new Error("Dossier context could not be created for missing project data.");
  if (campaign.projectId !== input.projectId || candidate.campaignId !== input.campaignId) {
    throw new Error("Dossier context scope does not match the claimed company.");
  }
  // A candidate keeps the strategy under which it entered the queue. Falling
  // back to the active strategy supports older rows created before version
  // pinning existed, without changing already-versioned work.
  const strategyVersionId = candidate.strategyVersionId ?? settings?.activeStrategyVersionId ?? null;
  const strategy = strategyVersionId
    ? await db.select().from(projectStrategyVersions).where(eq(projectStrategyVersions.id, strategyVersionId)).limit(1).then((rows) => rows[0] ?? null)
    : null;
  const context = {
    project: {
      id: project.id, name: project.name, objective: project.objective,
      context: project.context, scope: project.scope, constraints: project.constraints,
      outputRequirements: project.outputRequirements, outputLanguage: project.outputLanguage
    },
    strategy: strategy ? {
      id: strategy.id, version: strategy.version, title: strategy.title,
      summary: strategy.summary, strategy: strategy.strategy
    } : null,
    campaign: {
      id: campaign.id, name: campaign.name, entitySchema: campaign.entitySchema,
      qualificationRules: campaign.qualificationRules, documentTemplate: campaign.documentTemplate
    },
    candidate: { id: candidate.id, data: candidate.data, qualificationScore: candidate.qualificationScore },
    capturedAt: new Date().toISOString()
  };
  const contentHash = createHash("sha256").update(JSON.stringify(context)).digest("hex");
  const [snapshot] = await db.insert(dossierContextSnapshots).values({
    organizationId: MTI_ORGANIZATION_ID,
    projectId: input.projectId,
    campaignId: input.campaignId,
    candidateId: input.candidateId,
    runId: input.runId,
    strategyVersionId,
    context,
    contentHash
  }).returning();
  return snapshot;
}

export async function getDossierContextSnapshot(id: string) {
  const db = requireDatabase();
  return db.select().from(dossierContextSnapshots).where(and(
    eq(dossierContextSnapshots.id, id),
    eq(dossierContextSnapshots.organizationId, MTI_ORGANIZATION_ID)
  )).limit(1).then((rows) => rows[0] ?? null);
}
