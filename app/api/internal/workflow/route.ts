import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAgentContext } from "@/lib/ai/context";
import {
  absorbCollectionDirectives,
  addCollectionCandidate,
  applyDirectivesToCampaign,
  campaignCeilingCents,
  claimCollectionCandidate,
  createCollectionCampaign,
  crossLinkCollectionCampaign,
  dossierFanoutLimit,
  findCampaignEvidence,
  getCollectionBudget,
  getCollectionCampaign,
  getCollectionCoverage,
  listPendingDossierCandidates,
  markCollectionCampaignSaturated,
  recordCampaignEvidence,
  recordDossierResult,
  releaseCollectionCandidateClaim,
  reopenCollectionCampaign
} from "@/lib/collection-research";
import { requestEmbedding } from "@/lib/ai/litellm";
import { createClientChangeSet, submitClientChangeSet } from "@/lib/client-changes";
import { parseJson } from "@/lib/http";
import { isValidWorkflowRequest } from "@/lib/internal-auth";
import { invokeMcpTool } from "@/lib/mcp/platform";
import { getRunResearchCostCents } from "@/lib/research/engine";
import { repository } from "@/lib/repository";
import {
  collectionPlanSchema,
  executionPlanSchema,
  workerResultSchema
} from "@/lib/workflows/contracts";
import {
  markWorkerAttempt,
  persistWorkerResult,
  persistWorkflowPlan,
  reconcileWorkflowTerminal,
  updateWorkflowCheckpoint
} from "@/lib/workflows/state";



const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("load"),
    commandId: z.string().uuid(),
    runId: z.string().uuid().optional()
  }),
  z.object({
    action: z.literal("progress"),
    commandId: z.string().uuid(),
    runId: z.string().uuid(),
    commandStatus: z.enum(["planning", "executing", "review_required", "completed", "failed"]).optional(),
    runStatus: z.enum(["planning", "executing", "review_required", "completed", "failed"]).optional(),
    progress: z.number().int().min(0).max(100).optional()
  }),
  z.object({
    action: z.literal("report"),
    commandId: z.string().uuid(),
    runId: z.string().uuid(),
    projectId: z.string().uuid().nullable(),
    title: z.string().min(1).max(180),
    summary: z.string().max(5000),
    content: z.string().min(1).max(200000)
  }),
  z.object({
    action: z.literal("plan"),
    runId: z.string().uuid(),
    plan: executionPlanSchema
  }),
  z.object({
    action: z.literal("collection_plan"),
    runId: z.string().uuid(),
    projectId: z.string().uuid(),
    agendaId: z.string().uuid().nullable().optional(),
    plan: collectionPlanSchema
  }),
  z.object({
    action: z.literal("scouting_search"),
    runId: z.string().uuid(),
    projectId: z.string().uuid(),
    agendaId: z.string().uuid(),
    // Optional so a caller outside a campaign can still search. When present,
    // the campaign's evidence pool is consulted before any paid lookup.
    campaignId: z.string().uuid().optional(),
    candidateId: z.string().uuid().optional(),
    query: z.string().trim().min(1).max(2000)
  }),
  z.object({
    action: z.literal("steering_poll"),
    runId: z.string().uuid(),
    campaignId: z.string().uuid(),
    stage: z.enum(["scouting", "dossier"])
  }),
  z.object({
    action: z.literal("scouting_record"),
    runId: z.string().uuid(),
    campaignId: z.string().uuid(),
    candidates: z.array(z.record(z.string(), z.unknown())).max(200)
  }),
  z.object({
    action: z.literal("scouting_conclude"),
    runId: z.string().uuid(),
    campaignId: z.string().uuid(),
    saturated: z.boolean(),
    reason: z.string().trim().min(1).max(500)
  }),
  z.object({
    action: z.literal("dossier_fanout"),
    runId: z.string().uuid(),
    campaignId: z.string().uuid()
  }),
  z.object({
    action: z.literal("dossier_claim"),
    runId: z.string().uuid(),
    campaignId: z.string().uuid(),
    candidateId: z.string().uuid()
  }),
  z.object({
    action: z.literal("dossier_result"),
    runId: z.string().uuid(),
    campaignId: z.string().uuid(),
    candidateId: z.string().uuid(),
    leaseToken: z.string().min(1).max(200),
    status: z.enum(["completed", "disqualified", "failed"]),
    data: z.record(z.string(), z.unknown()).optional(),
    markdown: z.string().max(200000).nullable().optional(),
    reason: z.string().max(2000).nullable().optional()
  }),
  z.object({
    action: z.literal("collection_budget"),
    runId: z.string().uuid(),
    campaignId: z.string().uuid()
  }),
  z.object({
    action: z.literal("collection_continue_load"),
    runId: z.string().uuid(),
    campaignId: z.string().uuid(),
    resumeDiscovery: z.boolean().default(false)
  }),
  z.object({
    action: z.literal("cross_link"),
    runId: z.string().uuid(),
    campaignId: z.string().uuid()
  }),
  z.object({
    action: z.literal("note"),
    runId: z.string().uuid(),
    type: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(2000)
  }),
  z.object({
    action: z.literal("worker_attempt"),
    runId: z.string().uuid(),
    taskKey: z.string().min(1).max(80),
    attempt: z.number().int().min(1).max(20)
  }),
  z.object({
    action: z.literal("worker_result"),
    runId: z.string().uuid(),
    result: workerResultSchema
  }),
  z.object({
    action: z.literal("terminal"),
    commandId: z.string().uuid(),
    runId: z.string().uuid(),
    status: z.enum(["completed", "failed", "cancelled"]),
    error: z.string().max(10000).optional(),
    payload: z.record(z.unknown()).optional()
  })
]);

export async function POST(request: Request) {
  if (!isValidWorkflowRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const input = parsed.data;

  if (input.action === "load") {
    const command = await repository.getCommand(input.commandId);
    if (!command) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({
      command,
      context: await buildAgentContext(command.projectId, command.instruction, {
        commandId: command.id,
        runId: input.runId ?? null
      })
    });
  }

  if (input.action === "progress") {
    if (input.commandStatus) {
      await repository.updateCommand(input.commandId, { status: input.commandStatus });
    }
    await repository.updateRun(input.runId, {
      status: input.runStatus,
      progress: input.progress
    });
    await updateWorkflowCheckpoint(
      input.runId,
      input.runStatus ?? input.commandStatus ?? "executing",
      { progress: input.progress ?? null }
    );
    const transition = input.runStatus ?? input.commandStatus;
    if (transition) {
      await repository.appendEvent(input.runId, {
        type: `run.${transition}`,
        message: `Workflow entered ${transition.replace("_", " ")} state.`
      });
    }
    return NextResponse.json({ status: "updated" });
  }

  if (input.action === "plan") {
    const workers = await persistWorkflowPlan(input.runId, executionPlanSchema.parse(input.plan));
    await repository.appendEvent(input.runId, {
      type: "run.planned",
      message: `Execution plan created with ${input.plan.tasks.length} delegated tasks.`
    });
    return NextResponse.json({ status: "planned", workers });
  }

  if (input.action === "collection_plan") {
    // The research_sources MCP tool (Stage 3 will call it) requires a real,
    // existing agenda - `research_queries.agenda_id` is a NOT NULL foreign
    // key, not an optional scoping field. A command issued outside the
    // Projects page has no agenda attached, so create one rather than let
    // Stage 3 fail on a missing FK the moment it starts querying.
    const agendaId = input.agendaId ?? (await repository.createAgenda(input.projectId, {
      title: input.plan.campaignName,
      instruction: input.plan.objective,
      workType: "research"
    })).id;
    const campaign = await createCollectionCampaign({
      projectId: input.projectId,
      agendaId,
      name: input.plan.campaignName,
      entitySchema: input.plan.entitySchema,
      documentTemplate: input.plan.documentTemplate,
      dedupeKeys: input.plan.dedupeKeys,
      qualificationRules: input.plan.qualificationRules,
      targetCount: input.plan.targetCount,
      saturationRule: input.plan.saturationRule,
      // Scale the authorization with what was actually asked for. A campaign
      // for 100 entities is a different spend authorization than one for 5,
      // and the planner already knows which it is - so the ceiling comes from
      // the plan rather than making every large campaign stop at the low
      // default and wait for someone to notice.
      ceilingCents: campaignCeilingCents(input.plan.targetCount)
    });
    await repository.appendEvent(input.runId, {
      type: "run.collection_campaign_created",
      message: `Collection campaign "${campaign.name}" created with ` +
        `${campaign.entitySchema.length} declared field(s). Starting discovery.`
    });
    return NextResponse.json({
      status: "collection_campaign_created",
      campaignId: campaign.id,
      agendaId
    });
  }

  if (input.action === "scouting_search") {
    // Every search in a campaign funnels through here, which makes this the
    // one place worth checking for work the campaign has already paid for.
    // The research engine has its own cache, but it keys on the exact query
    // string, so two workers asking the same question in slightly different
    // words both miss it. Checking the campaign pool first costs one indexed
    // read and skips a paid provider call outright on a hit.
    if (input.campaignId) {
      const reuse = await findCampaignEvidence(
        input.campaignId,
        input.query,
        requestEmbedding
      );
      if (reuse.hit) {
        await repository.appendEvent(input.runId, {
          type: "run.research_reused",
          message: `Reused earlier campaign evidence for "${input.query.slice(0, 120)}" ` +
            `(${reuse.matchKind} match on "${reuse.matchedQuery?.slice(0, 120)}").`
        });
        return NextResponse.json({ result: reuse.evidence, reused: true });
      }
    }
    const result = await invokeMcpTool({
      toolName: "research_sources",
      arguments: {
        projectId: input.projectId,
        agendaId: input.agendaId,
        // Attributes this query's provider cost to the run, which is what
        // lets the campaign budget see external search spend at all.
        runId: input.runId,
        query: input.query,
        category: "web",
        queryBudget: 10,
        maxResults: 15
      },
      scope: {
        role: "worker",
        projectId: input.projectId,
        runId: input.runId,
        permissions: ["research:query"],
        // Above research_sources' own 5-cent budgetCents - a real ceiling,
        // not a rubber stamp that happens to always pass.
        maxCostCents: 50
      }
    });
    if (input.campaignId) {
      // Recorded after the fact and never allowed to fail the search: an
      // unavailable embedding provider should cost the campaign some repeated
      // lookups, not lose a result it already paid for.
      await recordCampaignEvidence({
        campaignId: input.campaignId,
        candidateId: input.candidateId ?? null,
        query: input.query,
        evidence: result,
        embedding: await requestEmbedding(input.query).catch(() => null)
      }).catch(() => undefined);
    }
    return NextResponse.json({ result, reused: false });
  }

  if (input.action === "steering_poll") {
    // Read-and-claim: several dossier workers poll concurrently, and a
    // directive handed to two of them would be applied twice.
    const directives = await absorbCollectionDirectives(input.campaignId, input.stage);
    // add_criteria has to outlive this poll, because dossier workers judge
    // qualification from the campaign rather than from the directive log.
    const campaign = directives.length > 0
      ? await applyDirectivesToCampaign(input.campaignId, directives)
      : await getCollectionCampaign(input.campaignId);
    for (const directive of directives) {
      await repository.appendEvent(input.runId, {
        type: "run.steering_absorbed",
        message: `Steering absorbed at ${input.stage}: ${directive.kind}` +
          (directive.instruction ? ` - ${directive.instruction.slice(0, 300)}` : "")
      });
    }
    return NextResponse.json({
      directives,
      stopDiscovery: directives.some((directive) => directive.kind === "stop_discovery"),
      qualificationRules: campaign?.qualificationRules ?? [],
      targetCount: campaign?.targetCount ?? null
    });
  }

  if (input.action === "scouting_record") {
    const outcomes = [];
    for (const candidate of input.candidates) {
      outcomes.push(await addCollectionCandidate(input.campaignId, candidate));
    }
    const coverage = await getCollectionCoverage(input.campaignId);
    return NextResponse.json({ outcomes, coverage });
  }

  if (input.action === "scouting_conclude") {
    if (input.saturated) {
      await markCollectionCampaignSaturated(input.campaignId, input.reason);
    }
    await repository.appendEvent(input.runId, {
      type: input.saturated ? "run.scouting_saturated" : "run.scouting_stopped",
      message: input.reason
    });
    const coverage = await getCollectionCoverage(input.campaignId);
    return NextResponse.json({ coverage });
  }

  if (input.action === "dossier_fanout") {
    const campaign = await getCollectionCampaign(input.campaignId);
    if (!campaign) return NextResponse.json({ error: "campaign_not_found" }, { status: 404 });
    const pending = await listPendingDossierCandidates(input.campaignId);
    // Fan-out width is bounded by what this campaign asked for plus headroom,
    // and by a hard safety ceiling above that: a runaway discovery step must
    // not turn into an unbounded number of paid research workers. Candidates
    // beyond the cap stay pending and are picked up by a continuation run
    // rather than stranded.
    const limit = dossierFanoutLimit(campaign.targetCount);
    const selected = pending.slice(0, limit);
    if (pending.length > selected.length) {
      await repository.appendEvent(input.runId, {
        type: "run.dossier_fanout_capped",
        message: `${pending.length} candidates await research but only ${limit} ` +
          "will be processed in this run - the per-run fan-out ceiling. The rest stay " +
          "pending and can be continued without rediscovering them."
      });
    }
    return NextResponse.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        entitySchema: campaign.entitySchema,
        documentTemplate: campaign.documentTemplate,
        qualificationRules: campaign.qualificationRules
      },
      candidates: selected.map((candidate) => ({ id: candidate.id, data: candidate.data })),
      pendingTotal: pending.length
    });
  }

  if (input.action === "dossier_claim") {
    const claim = await claimCollectionCandidate({
      campaignId: input.campaignId,
      candidateId: input.candidateId,
      leaseSeconds: 900
    });
    return NextResponse.json({ claimed: claim !== null, leaseToken: claim?.leaseToken ?? null });
  }

  if (input.action === "dossier_result") {
    const candidate = await recordDossierResult(input.candidateId, {
      status: input.status,
      data: input.data,
      markdown: input.markdown,
      reason: input.reason
    });
    if (!candidate) return NextResponse.json({ error: "candidate_not_found" }, { status: 404 });
    await releaseCollectionCandidateClaim(input.campaignId, input.candidateId, input.leaseToken);
    await repository.appendEvent(input.runId, {
      type: `run.dossier_${input.status}`,
      message: input.reason?.slice(0, 500) ??
        `Candidate dossier ${input.status}.`
    });
    return NextResponse.json({ status: candidate.dossierStatus });
  }

  if (input.action === "collection_budget") {
    return NextResponse.json(await getCollectionBudget(input.campaignId, {
      getRunCostMicros: () => repository.getRunCostMicros(input.runId),
      getResearchCostCents: () => getRunResearchCostCents(input.runId),
      getProjectBudgetCents: async (projectId) =>
        (await repository.getProject(projectId))?.budgetCents ?? null
    }));
  }

  if (input.action === "collection_continue_load") {
    const campaign = await getCollectionCampaign(input.campaignId);
    if (!campaign) return NextResponse.json({ error: "campaign_not_found" }, { status: 404 });
    // Reopening is what moves transiently failed candidates back to pending and
    // freezes spend-to-date, so it must happen before the budget is read - the
    // continuation's allowance is measured from the frozen figure.
    //
    // The run's own spend is measured first and handed in, so that a retried
    // continuation does not re-snapshot and count its own spend twice.
    const runSpentCents =
      Math.ceil(await repository.getRunCostMicros(input.runId) / 10_000) +
      await getRunResearchCostCents(input.runId);
    const reopened = await reopenCollectionCampaign(input.campaignId, {
      retryFailed: true,
      resumeDiscovery: input.resumeDiscovery,
      currentRunSpentCents: runSpentCents
    });
    const pending = await listPendingDossierCandidates(input.campaignId);
    const budget = await getCollectionBudget(input.campaignId, {
      getRunCostMicros: () => repository.getRunCostMicros(input.runId),
      getResearchCostCents: () => getRunResearchCostCents(input.runId),
      getProjectBudgetCents: async (projectId) =>
        (await repository.getProject(projectId))?.budgetCents ?? null
    });
    await repository.appendEvent(input.runId, {
      type: "run.collection_continued_load",
      message: `Continuing "${campaign.name}": ${pending.length} candidate(s) pending` +
        (reopened.retried > 0 ? `, ${reopened.retried} previously failed candidate(s) retried` : "") +
        `. Spent ${budget.spentCents} of ${budget.ceilingCents} cents.`
    });
    return NextResponse.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        entitySchema: campaign.entitySchema,
        documentTemplate: campaign.documentTemplate,
        qualificationRules: campaign.qualificationRules,
        // The campaign's original discovery queries are not stored, so a
        // resumed discovery pass seeds from the objective it was built for.
        // The loop treats these as suggestions and picks its own queries
        // anyway, and it now also knows what has already been found.
        discoveryQueries: [campaign.name],
        targetCount: campaign.targetCount,
        status: reopened.campaign?.status ?? campaign.status,
        discoveredCount: campaign.discoveredCount
      },
      pendingTotal: pending.length,
      budget
    });
  }

  if (input.action === "cross_link") {
    const published = await crossLinkCollectionCampaign(input.campaignId, {
      resolveFolderId: async () => (await repository.createFolder("Collected dossiers")).id,
      createDocument: (document) => repository.createDocument({
        ...document,
        filename: `${document.title}.md`,
        mimeType: "text/markdown",
        sourceKind: "text",
        sizeBytes: Buffer.byteLength(document.markdown, "utf8"),
        pageCount: null,
        wordCount: (document.markdown.trim().match(/\S+/g) ?? []).length,
        storageKey: null
      }),
      ensureDatabase: async (name, description) => {
        const existing = (await repository.listClientDatabases()).find((item) => item.name === name);
        return existing ?? await repository.createClientDatabase({ name, description });
      },
      createChangeSet: (set) => createClientChangeSet(set),
      submitChangeSet: (changeSetId) => submitClientChangeSet(changeSetId)
    });
    await repository.appendEvent(input.runId, {
      type: "run.collection_cross_linked",
      message: published.changeSetId
        ? `${published.published} dossier document(s) created and proposed as client-data rows. ` +
          "The rows are staged for review - they are not in the database until approved."
        : "No completed dossiers were ready to publish."
    });
    return NextResponse.json(published);
  }

  if (input.action === "note") {
    await repository.appendEvent(input.runId, { type: input.type, message: input.message });
    return NextResponse.json({ status: "noted" });
  }

  if (input.action === "worker_attempt") {
    const worker = await markWorkerAttempt(input.runId, input.taskKey, input.attempt);
    if (!worker) return NextResponse.json({ error: "worker_not_found" }, { status: 404 });
    return NextResponse.json({ status: "executing" });
  }

  if (input.action === "worker_result") {
    const worker = await persistWorkerResult(input.runId, workerResultSchema.parse(input.result));
    if (!worker) return NextResponse.json({ error: "worker_not_found" }, { status: 404 });
    return NextResponse.json({ status: "completed" });
  }

  if (input.action === "terminal") {
    await reconcileWorkflowTerminal(input);
    return NextResponse.json({ status: input.status });
  }

  const report = await repository.createReport({
    projectId: input.projectId,
    title: input.title,
    summary: input.summary,
    content: input.content
  });
  await repository.updateCommand(input.commandId, { status: "review_required" });
  await repository.updateRun(input.runId, { status: "review_required", progress: 100 });
  return NextResponse.json({ reportId: report.id, status: "review_required" }, { status: 201 });
}
