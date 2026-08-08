import { task, tasks } from "@trigger.dev/sdk";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requestModel } from "@/lib/ai/litellm";
import { parseModelJson } from "@/lib/ai/model-json";
import { addCollectionCandidate } from "@/lib/collection-research";
import { linkCompanyToProject, registerCompany } from "@/lib/company-research";
import { requireDatabase } from "@/lib/db/client";
import {
  collectionCampaigns, collectionCandidates, companyProjectLinks, projectResearchSettings,
  projectStrategyVersions, companyDiscoveryEvents
} from "@/lib/db/schema";
import { runResearchQuery } from "@/lib/research/engine";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";

const discoveryResult = z.object({
  candidates: z.array(z.object({
    legalName: z.string().trim().min(1).max(300),
    aliases: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
    website: z.string().trim().max(500).default(""),
    countryCode: z.string().trim().min(2).max(3).default("KR"),
    location: z.string().trim().max(500).default(""),
    industry: z.string().trim().max(300).default(""),
    qualificationReason: z.string().trim().min(1).max(2000),
    qualificationScore: z.number().int().min(0).max(100)
  })).max(20)
});

function text(response: unknown) {
  const content = (response as { choices?: Array<{ message?: { content?: string | null } }> })
    ?.choices?.[0]?.message?.content;
  if (!content) throw new Error("The discovery model returned no content.");
  return content;
}

export async function runResearchDiscovery(projectId: string, cyclesRemaining = 3) {
  const db = requireDatabase();
  const [settings] = await db.select().from(projectResearchSettings)
    .where(eq(projectResearchSettings.projectId, projectId)).limit(1);
  if (!settings || settings.researchPaused || !settings.discoveryEnabled) return { status: "paused" as const };
  if (!settings.activeStrategyVersionId) return { status: "waiting_for_strategy" as const };
  const [strategy] = await db.select().from(projectStrategyVersions)
    .where(eq(projectStrategyVersions.id, settings.activeStrategyVersionId)).limit(1);
  const [campaign] = await db.select().from(collectionCampaigns)
    .where(eq(collectionCampaigns.projectId, projectId)).orderBy(desc(collectionCampaigns.createdAt)).limit(1);
  if (!strategy || !campaign?.agendaId) return { status: "waiting_for_campaign" as const };
  const [{ value: queued }] = await db.select({ value: count() }).from(collectionCandidates).where(and(
    eq(collectionCandidates.campaignId, campaign.id),
    eq(collectionCandidates.queueStatus, "queued"),
    eq(collectionCandidates.dossierStatus, "pending")
  ));
  if (Number(queued) >= settings.queueBufferTarget) return { status: "buffer_full" as const };

  const fallbackQueries = [
    `${strategy.strategy.geographicScope.join(" ")} ${strategy.strategy.industries.join(" ")} companies`,
    `${strategy.strategy.geographicScope.join(" ")} companies ${strategy.strategy.targetProfile.slice(0, 180)}`
  ].filter((item) => item.trim().length > 10);
  const families = strategy.strategy.queryFamilies.length > 0 ? strategy.strategy.queryFamilies : fallbackQueries;
  if (families.length === 0) return { status: "no_query_plan" as const };
  const cursor = settings.discoveryCursor % families.length;
  const queries = Array.from({ length: Math.min(3, families.length) }, (_, offset) => families[(cursor + offset) % families.length]);
  const evidence = [];
  for (const query of queries) {
    const result = await runResearchQuery({
      projectId, agendaId: campaign.agendaId, query, category: "web",
      language: /[\uac00-\ud7af]/.test(query) ? "ko" : "en",
      queryBudget: 2, maxResults: 10
    });
    evidence.push(...result.evidence);
  }
  const response = await requestModel("worker_structured", [
    {
      role: "system",
      content: [
        "Extract real candidate companies from supplied web evidence and preliminarily qualify them against the approved strategy.",
        "Do not invent a company, domain, location, or qualification fact. Exclude directories, news publishers, people, and ambiguous brands.",
        'Return JSON only: {"candidates":[{"legalName":"string","aliases":["Korean or English alternate name"],"website":"string","countryCode":"KR","location":"string","industry":"string","qualificationReason":"string","qualificationScore":0}]}'
      ].join("\n")
    },
    { role: "user", content: JSON.stringify({ strategy: strategy.strategy, evidence }) }
  ], { structuredOutput: true });
  const extracted = discoveryResult.parse(parseModelJson(text(response)));
  let added = 0;
  for (const candidate of extracted.candidates.slice(0, Math.max(0, settings.queueBufferTarget - Number(queued)))) {
    const company = await registerCompany({
      legalName: candidate.legalName,
      tradingNames: candidate.aliases,
      domain: candidate.website || null,
      countryCode: candidate.countryCode || "KR",
      locations: candidate.location ? [{ description: candidate.location }] : [],
      classifications: candidate.industry ? [candidate.industry] : [],
      confidence: candidate.qualificationScore,
      completeness: candidate.website && candidate.location ? 60 : 35,
      source: candidate.website ? {
        url: candidate.website,
        type: "discovery",
        title: `${candidate.legalName} discovery evidence`,
        evidence: { qualificationReason: candidate.qualificationReason, queries }
      } : undefined
    });
    if (company.companyId) {
      const [alreadyInProject] = await db.select({ id: companyProjectLinks.id }).from(companyProjectLinks).where(and(
        eq(companyProjectLinks.companyId, company.companyId),
        eq(companyProjectLinks.projectId, projectId)
      )).limit(1);
      if (alreadyInProject) {
        await db.insert(companyDiscoveryEvents).values({
          organizationId: MTI_ORGANIZATION_ID, projectId, campaignId: campaign.id,
          companyId: company.companyId, query: queries.join(" | "), resultUrl: candidate.website || null,
          discoveredName: candidate.legalName, resolution: "existing_project",
          resolutionReason: "Canonical company is already linked to this project.", strategyVersionId: strategy.id
        });
        continue;
      }
    }
    const result = await addCollectionCandidate(campaign.id, candidate);
    if (result.resolution === "new") {
      added += 1;
      await db.update(collectionCandidates).set({
        strategyVersionId: strategy.id,
        qualificationScore: candidate.qualificationScore,
        queueStatus: "queued",
        updatedAt: new Date()
      }).where(eq(collectionCandidates.id, result.candidateId));
      if (company.companyId) {
        await linkCompanyToProject({
          companyId: company.companyId,
          projectId,
          agendaId: campaign.agendaId,
          disposition: "queued"
        });
      }
    }
    await db.insert(companyDiscoveryEvents).values({
      organizationId: MTI_ORGANIZATION_ID, projectId, campaignId: campaign.id,
      candidateId: result.candidateId, companyId: company.companyId,
      query: queries.join(" | "), resultUrl: candidate.website || null,
      discoveredName: candidate.legalName, resolution: result.resolution,
      resolutionReason: company.match ? `Canonical match: ${company.match.tier}.` : candidate.qualificationReason,
      strategyVersionId: strategy.id
    });
  }
  await db.update(projectResearchSettings).set({
    discoveryCursor: cursor + queries.length, lastDiscoveryAt: new Date(), updatedAt: new Date()
  }).where(eq(projectResearchSettings.id, settings.id));
  await tasks.trigger("research-project-dispatcher", { projectId }, {
    idempotencyKey: `discovery-dispatch:${projectId}:${Date.now()}`
  });
  if (added > 0 && cyclesRemaining > 1 && Number(queued) + added < settings.queueBufferTarget) {
    await tasks.trigger("research-discovery-worker", { projectId, cyclesRemaining: cyclesRemaining - 1 }, {
      idempotencyKey: `discovery-refill:${projectId}:${settings.discoveryCursor}:${cyclesRemaining}`
    });
  }
  return { status: "completed" as const, queries: queries.length, added };
}

export const researchDiscoveryWorker = task({
  id: "research-discovery-worker",
  queue: { concurrencyLimit: 1 },
  maxDuration: 1800,
  run: ({ projectId, cyclesRemaining }: { projectId: string; cyclesRemaining?: number }) =>
    runResearchDiscovery(projectId, cyclesRemaining ?? 3)
});
