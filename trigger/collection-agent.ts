import { task } from "@trigger.dev/sdk";
import {
  extractToolCalls,
  requestModel,
  type ChatMessage,
  type ToolCall,
  type ToolDefinition
} from "@/lib/ai/litellm";
import { parseModelJson } from "@/lib/ai/model-json";
import { callWorkflowApp } from "@/lib/workflows/callback";
import { dossierExtractionSchema, dossierQueryPlanSchema } from "@/lib/workflows/contracts";
import type { EntityFieldSchema } from "@/lib/collection-research";

/**
 * Phase 13 Stage 3 - Scouting Loop. Unlike the fixed pipeline in
 * trigger/executive-agent.ts (one non-tool-using call per task), this is a
 * genuine tool-calling loop: the model decides which query to run next and
 * when it has found what it can, rather than working through a
 * host-generated list. The host still enforces the hard bounds - step cap,
 * saturation - regardless of what the model wants to keep doing.
 *
 * Every state-touching operation goes through callWorkflowApp, not a direct
 * lib/collection-research.ts or lib/mcp/platform.ts import: this task runs
 * in the Trigger.dev worker process, which - like every other task in this
 * directory - is not assumed to reach Postgres directly. Only requestModel
 * is called directly, because it has its own dual-mode fallback for exactly
 * this reason.
 */

export type ScoutingPayload = {
  runId: string;
  campaignId: string;
  projectId: string;
  agendaId: string;
  entitySchema: EntityFieldSchema[];
  qualificationRules: string[];
  discoveryQueries: string[];
};

export type ScoutingResult = {
  campaignId: string;
  stopReason: string;
  saturated: boolean;
  discovered: number;
  duplicates: number;
};

const MAX_STEPS = 15;
const CONSECUTIVE_EMPTY_LIMIT = 3;

const SEARCH_WEB_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_web",
    description: "Search the web for candidate entities matching the campaign's criteria. Returns cited excerpts, not full pages.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "One specific search query." }
      },
      required: ["query"]
    }
  }
};

const RECORD_CANDIDATES_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "record_candidates",
    description: "Submit entities found in search results that match the campaign's qualification rules. Already-known entities are detected automatically - submitting one again is harmless.",
    parameters: {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          description: "One object per entity, using the declared entity schema's field names as keys.",
          items: { type: "object" }
        }
      },
      required: ["candidates"]
    }
  }
};

/** Injectable so the loop's control flow is testable without a live model, MCP server, or database. */
type ScoutingDeps = {
  requestModel: typeof requestModel;
  callWorkflowApp: typeof callWorkflowApp;
};

const defaultDeps: ScoutingDeps = { requestModel, callWorkflowApp };

function safeParseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function responseMessage(response: unknown): { content: string | null } {
  const message = (response as {
    choices?: Array<{ message?: { content?: string | null } }>;
  } | null | undefined)?.choices?.[0]?.message;
  return { content: message?.content ?? null };
}

type CoverageSnapshot = { remaining: number | null; discovered: number; duplicates: number } | null;

/** Mirrors CollectionBudget in lib/collection-research.ts, over the HTTP boundary. */
type CollectionBudgetSnapshot = {
  ceilingCents: number;
  spentCents: number;
  remainingCents: number;
  exhausted: boolean;
};

/**
 * Reads the campaign's spend ceiling, failing closed.
 *
 * A budget check that cannot be completed stops the work rather than waving
 * it through: continuing would mean spending money we can no longer account
 * for. The stop is reported with its real cause, so an unverifiable budget is
 * never mistaken for a finished campaign.
 */
async function readBudget(
  payload: { runId: string; campaignId: string },
  deps: { callWorkflowApp: typeof callWorkflowApp }
): Promise<{ exhausted: boolean; reason: string | null }> {
  try {
    const budget = await deps.callWorkflowApp<CollectionBudgetSnapshot>({
      action: "collection_budget",
      runId: payload.runId,
      campaignId: payload.campaignId
    });
    if (typeof budget?.exhausted !== "boolean") {
      return { exhausted: true, reason: "Campaign spend could not be verified." };
    }
    return {
      exhausted: budget.exhausted,
      reason: budget.exhausted
        ? `Campaign spend ceiling reached (${budget.spentCents} of ${budget.ceilingCents} cents).`
        : null
    };
  } catch (error) {
    return {
      exhausted: true,
      reason: `Campaign spend could not be verified: ${
        error instanceof Error ? error.message : "budget check failed"
      }.`
    };
  }
}

export async function runScoutingLoop(
  payload: ScoutingPayload,
  deps: ScoutingDeps = defaultDeps
): Promise<ScoutingResult> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are the discovery step of a research campaign.",
        `Find entities with these fields: ${JSON.stringify(payload.entitySchema)}.`,
        `Qualification rules: ${payload.qualificationRules.join("; ") || "none stated beyond the field descriptions"}.`,
        "Call search_web to look for candidates, then call record_candidates for entities that qualify - " +
          "one object per entity, keyed by the declared field names. Do not invent facts you did not find; " +
          "omit a field rather than guessing at it.",
        "When you believe you have found everything findable, or you are seeing the same entities repeat, " +
          "stop calling tools and reply with a short summary instead."
      ].join("\n")
    },
    {
      role: "user",
      content: `Queries to consider first (you may run others): ${JSON.stringify(payload.discoveryQueries)}`
    }
  ];

  let consecutiveEmptyRounds = 0;
  let stopReason: string | null = null;
  // Tracked separately from stopReason because the three ways this loop can
  // end are three different facts: the campaign really is exhausted, the step
  // cap cut it off, or the budget did. Only the first means "done".
  let saturated = false;
  let lastCoverage: CoverageSnapshot = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    const budget = await readBudget(payload, deps);
    if (budget.exhausted) {
      stopReason = `${budget.reason} Discovery stopped before finishing.`;
      break;
    }

    const response = await deps.requestModel("worker_structured", messages, {
      runId: payload.runId,
      tools: [SEARCH_WEB_TOOL, RECORD_CANDIDATES_TOOL]
    });
    const toolCalls = extractToolCalls(response);
    const { content } = responseMessage(response);

    if (toolCalls.length === 0) {
      stopReason = content
        ? `Model concluded discovery: ${content.slice(0, 300)}`
        : "Model returned no further tool calls.";
      saturated = true;
      break;
    }

    messages.push({ role: "assistant", content, tool_calls: toolCalls });

    let roundAddedNew = false;
    let roundCalledRecord = false;
    for (const call of toolCalls) {
      const outcome = await runOneToolCall(call, payload, deps);
      if (call.function.name === "record_candidates") roundCalledRecord = true;
      if (outcome.addedNew) roundAddedNew = true;
      if (outcome.coverage) lastCoverage = outcome.coverage;
      messages.push({ role: "tool", tool_call_id: call.id, content: outcome.resultText });
    }

    if (lastCoverage?.remaining === 0) {
      stopReason = `Target count reached (${lastCoverage.discovered} discovered).`;
      saturated = true;
      break;
    }
    // A round that only searched, without ever calling record_candidates,
    // is "still gathering" - it says nothing about saturation either way,
    // so it neither trips nor resets the counter. Only a round that
    // actually tried to record something and came up empty counts as
    // evidence the campaign might be exhausted.
    if (roundCalledRecord) {
      consecutiveEmptyRounds = roundAddedNew ? 0 : consecutiveEmptyRounds + 1;
      if (consecutiveEmptyRounds >= CONSECUTIVE_EMPTY_LIMIT) {
        stopReason = `No new distinct entities across ${CONSECUTIVE_EMPTY_LIMIT} consecutive rounds.`;
        saturated = true;
        break;
      }
    }
  }

  if (!stopReason) {
    stopReason = `Reached the ${MAX_STEPS}-step discovery limit before saturating.`;
  }

  const concluded = await deps.callWorkflowApp<{ coverage: CoverageSnapshot }>({
    action: "scouting_conclude",
    runId: payload.runId,
    campaignId: payload.campaignId,
    saturated,
    reason: stopReason
  });
  const finalCoverage = concluded.coverage ?? lastCoverage;

  return {
    campaignId: payload.campaignId,
    stopReason,
    saturated,
    discovered: finalCoverage?.discovered ?? 0,
    duplicates: finalCoverage?.duplicates ?? 0
  };
}

async function runOneToolCall(
  call: ToolCall,
  payload: ScoutingPayload,
  deps: ScoutingDeps
): Promise<{ resultText: string; addedNew: boolean; coverage: CoverageSnapshot }> {
  const args = safeParseArguments(call.function.arguments);

  if (call.function.name === "search_web") {
    try {
      const { result } = await deps.callWorkflowApp<{ result: unknown }>({
        action: "scouting_search",
        runId: payload.runId,
        projectId: payload.projectId,
        agendaId: payload.agendaId,
        query: String(args.query ?? "").slice(0, 2000)
      });
      // Truncated, not because the model can't handle more, but because an
      // unbounded search result blowing up the running conversation is
      // exactly the kind of cost the step cap can't see coming.
      return { resultText: JSON.stringify(result).slice(0, 20000), addedNew: false, coverage: null };
    } catch (error) {
      return {
        resultText: JSON.stringify({ error: error instanceof Error ? error.message : "search failed" }),
        addedNew: false,
        coverage: null
      };
    }
  }

  if (call.function.name === "record_candidates") {
    const candidates = Array.isArray(args.candidates) ? args.candidates : [];
    const clean = candidates.filter(
      (candidate): candidate is Record<string, unknown> =>
        Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate)
    );
    if (clean.length === 0) {
      return { resultText: JSON.stringify({ recorded: 0, outcomes: [] }), addedNew: false, coverage: null };
    }
    const { outcomes, coverage } = await deps.callWorkflowApp<{
      outcomes: Array<{ resolution: string }>;
      coverage: CoverageSnapshot;
    }>({
      action: "scouting_record",
      runId: payload.runId,
      campaignId: payload.campaignId,
      candidates: clean
    });
    const addedNew = outcomes.some((outcome) => outcome.resolution === "new");
    return {
      resultText: JSON.stringify({ recorded: outcomes.length, outcomes }),
      addedNew,
      coverage
    };
  }

  return {
    resultText: JSON.stringify({ error: `Unknown tool "${call.function.name}".` }),
    addedNew: false,
    coverage: null
  };
}

export const scoutingLoopTask = task({
  id: "scouting-loop",
  maxDuration: 1800,
  run: (payload: ScoutingPayload) => runScoutingLoop(payload)
});

/**
 * Phase 13 Stage 4 - Dossier Loop. One worker per discovered candidate,
 * fanned out by the executive. Two distinct model calls, deliberately not
 * one: `worker_structured` fills in the campaign's declared fields (an
 * extraction job, where inventing a plausible value is the failure mode to
 * design against), then `worker_writing` turns the verified facts into the
 * campaign's document (a prose job, where the facts are already fixed). A
 * single combined call would let the writing step quietly introduce
 * "facts" the extraction step never found.
 */

export type DossierPayload = {
  runId: string;
  campaignId: string;
  projectId: string;
  agendaId: string;
  candidateId: string;
  candidateData: Record<string, unknown>;
  entitySchema: EntityFieldSchema[];
  documentTemplate: string;
  qualificationRules: string[];
};

export type DossierResult = {
  candidateId: string;
  status: "completed" | "disqualified" | "failed" | "skipped" | "budget_exhausted";
  reason: string | null;
};

const DOSSIER_SEARCH_STEPS = 4;

type DossierDeps = {
  requestModel: typeof requestModel;
  callWorkflowApp: typeof callWorkflowApp;
};

const defaultDossierDeps: DossierDeps = { requestModel, callWorkflowApp };

function entityLabel(data: Record<string, unknown>) {
  const first = Object.values(data).find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof first === "string" ? first.slice(0, 120) : "this entity";
}

export async function runDossierLoop(
  payload: DossierPayload,
  deps: DossierDeps = defaultDossierDeps
): Promise<DossierResult> {
  // Checked before claiming, so an exhausted budget leaves the candidate
  // unclaimed and plainly still pending rather than locked behind a lease
  // nobody is working on.
  const budget = await readBudget(payload, deps);
  if (budget.exhausted) {
    return { candidateId: payload.candidateId, status: "budget_exhausted", reason: budget.reason };
  }

  const claim = await deps.callWorkflowApp<{ claimed: boolean; leaseToken: string | null }>({
    action: "dossier_claim",
    runId: payload.runId,
    campaignId: payload.campaignId,
    candidateId: payload.candidateId
  });
  // Another worker holds an unexpired lease on this candidate. Skipping is
  // correct and not an error - the claim is what makes the fan-out safe to
  // retry without paying for the same research twice.
  if (!claim.claimed || !claim.leaseToken) {
    return { candidateId: payload.candidateId, status: "skipped", reason: "Already claimed by another worker." };
  }
  const leaseToken = claim.leaseToken;
  const label = entityLabel(payload.candidateData);

  try {
    const evidence = await gatherDossierEvidence(payload, deps, label);

    const extraction = await deps.requestModel("worker_structured", [
      {
        role: "system",
        content: [
          "Fill in the declared fields for one entity from the supplied evidence.",
          `Fields: ${JSON.stringify(payload.entitySchema)}.`,
          payload.qualificationRules.length > 0
            ? `The entity qualifies only if: ${payload.qualificationRules.join("; ")}.`
            : "No extra qualification rules beyond the field descriptions.",
          'Return JSON only: {"qualifies":true|false,"reason":"string","fields":{"field_name":"value"}}.',
          "Omit any field the evidence does not support. Never guess a value to fill a gap - an " +
            "absent field is a usable fact, an invented one is not."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({ knownSoFar: payload.candidateData, evidence })
      }
    ], { runId: payload.runId });

    const extracted = dossierExtractionSchema.parse(
      parseModelJson(dossierText(extraction))
    );

    if (!extracted.qualifies) {
      await deps.callWorkflowApp({
        action: "dossier_result",
        runId: payload.runId,
        campaignId: payload.campaignId,
        candidateId: payload.candidateId,
        leaseToken,
        status: "disqualified",
        data: extracted.fields,
        reason: `${label}: ${extracted.reason}`.slice(0, 2000)
      });
      return { candidateId: payload.candidateId, status: "disqualified", reason: extracted.reason };
    }

    const merged = { ...payload.candidateData, ...extracted.fields };
    const writeUp = await deps.requestModel("worker_writing", [
      {
        role: "system",
        content: [
          "Write one markdown document about a single entity, following the supplied template.",
          "Template:",
          payload.documentTemplate,
          "Use only the supplied fields and evidence. Where the template asks for something the " +
            "evidence does not cover, write that it is not established rather than filling the gap.",
          "Return the markdown document itself, with no preamble and no code fence."
        ].join("\n")
      },
      { role: "user", content: JSON.stringify({ fields: merged, evidence }) }
    ], { runId: payload.runId });

    const markdown = dossierText(writeUp).trim();
    if (markdown.length === 0) {
      throw new Error("The writing step returned an empty document.");
    }

    await deps.callWorkflowApp({
      action: "dossier_result",
      runId: payload.runId,
      campaignId: payload.campaignId,
      candidateId: payload.candidateId,
      leaseToken,
      status: "completed",
      data: extracted.fields,
      markdown: markdown.slice(0, 200000),
      reason: `Dossier written for ${label}.`
    });
    return { candidateId: payload.candidateId, status: "completed", reason: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Dossier research failed.";
    // Record the failure and release the lease rather than letting the claim
    // sit until it expires - a failed candidate should be visibly failed, and
    // reclaimable, immediately.
    await deps.callWorkflowApp({
      action: "dossier_result",
      runId: payload.runId,
      campaignId: payload.campaignId,
      candidateId: payload.candidateId,
      leaseToken,
      status: "failed",
      reason: `${label}: ${reason}`.slice(0, 2000)
    });
    return { candidateId: payload.candidateId, status: "failed", reason };
  }
}

/** A short, bounded search pass - the model picks the queries, the host caps the count. */
async function gatherDossierEvidence(
  payload: DossierPayload,
  deps: DossierDeps,
  label: string
): Promise<unknown[]> {
  const planned = await deps.requestModel("worker_structured", [
    {
      role: "system",
      content: [
        `Plan up to ${DOSSIER_SEARCH_STEPS} web searches to research one specific entity in depth.`,
        `Fields that need supporting evidence: ${JSON.stringify(payload.entitySchema)}.`,
        'Return JSON only: {"queries":["string"]}.'
      ].join("\n")
    },
    { role: "user", content: JSON.stringify({ entity: payload.candidateData }) }
  ], { runId: payload.runId });

  let queries: string[];
  try {
    queries = dossierQueryPlanSchema.parse(parseModelJson(dossierText(planned))).queries;
  } catch {
    // A malformed plan is not worth failing the candidate over - fall back to
    // the entity's own label as a single query.
    queries = [label];
  }

  const evidence: unknown[] = [];
  for (const query of queries.slice(0, DOSSIER_SEARCH_STEPS)) {
    try {
      const { result } = await deps.callWorkflowApp<{ result: unknown }>({
        action: "scouting_search",
        runId: payload.runId,
        projectId: payload.projectId,
        agendaId: payload.agendaId,
        query: query.slice(0, 2000)
      });
      evidence.push(result);
    } catch (error) {
      evidence.push({ query, error: error instanceof Error ? error.message : "search failed" });
    }
  }
  return evidence;
}

function dossierText(response: unknown) {
  const content = (response as {
    choices?: Array<{ message?: { content?: string | null } }>;
  } | null | undefined)?.choices?.[0]?.message?.content;
  if (!content) throw new Error("The model returned no message content.");
  return content;
}

export const dossierWorkerTask = task({
  id: "dossier-worker",
  queue: { concurrencyLimit: 10 },
  maxDuration: 1800,
  run: (payload: DossierPayload) => runDossierLoop(payload)
});
