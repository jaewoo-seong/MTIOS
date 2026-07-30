import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAgentContext } from "@/lib/ai/context";
import {
  addCollectionCandidate,
  claimCollectionCandidate,
  createCollectionCampaign,
  crossLinkCollectionCampaign,
  getCollectionBudget,
  getCollectionCampaign,
  getCollectionCoverage,
  listPendingDossierCandidates,
  markCollectionCampaignSaturated,
  recordDossierResult,
  releaseCollectionCandidateClaim
} from "@/lib/collection-research";
import { createClientChangeSet, submitClientChangeSet } from "@/lib/client-changes";
import { parseJson } from "@/lib/http";
import { isValidWorkflowRequest } from "@/lib/internal-auth";
import { invokeMcpTool } from "@/lib/mcp/platform";
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

/** Stage 4 guardrail: the most candidates any single run will research. */
const DOSSIER_FANOUT_LIMIT = 100;

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
    query: z.string().trim().min(1).max(2000)
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
      saturationRule: input.plan.saturationRule
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
    const result = await invokeMcpTool({
      toolName: "research_sources",
      arguments: {
        projectId: input.projectId,
        agendaId: input.agendaId,
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
    return NextResponse.json({ result });
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
    // Hard ceiling on fan-out width, independent of what the campaign's
    // targetCount or the Scouting Loop produced: a runaway discovery step
    // must not turn into an unbounded number of paid research workers.
    const selected = pending.slice(0, DOSSIER_FANOUT_LIMIT);
    if (pending.length > selected.length) {
      await repository.appendEvent(input.runId, {
        type: "run.dossier_fanout_capped",
        message: `${pending.length} candidates await research but only ${DOSSIER_FANOUT_LIMIT} ` +
          "will be processed in this run - the per-run fan-out ceiling. The rest stay pending."
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
      getProjectBudgetCents: async (projectId) =>
        (await repository.getProject(projectId))?.budgetCents ?? null
    }));
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
