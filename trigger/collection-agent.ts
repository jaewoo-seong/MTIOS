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
import type { EvidenceCapability } from "@/lib/research/evidence-capabilities";

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
  /** Null means "run until saturation", bounded only by the step ceiling. */
  targetCount?: number | null;
  /** Set on a continuation run, so discovery knows what already exists. */
  alreadyDiscovered?: number;
};

export type ScoutingResult = {
  campaignId: string;
  stopReason: string;
  saturated: boolean;
  discovered: number;
  duplicates: number;
  steering: string[];
};

/**
 * Hard ceiling on discovery rounds, independent of what a campaign asked for.
 * The working limit comes from `discoveryStepLimit` below; this only exists so
 * a campaign with no target cannot loop indefinitely.
 */
const MAX_STEPS_HARD_LIMIT = 60;
const CONSECUTIVE_EMPTY_LIMIT = 3;

/**
 * How many discovery rounds this campaign gets.
 *
 * The old fixed 15 was the real reason a large campaign quietly under-
 * delivered: reaching 100 entities inside 15 rounds requires sustaining about
 * seven net-new finds every round, and a round that returns five is normal.
 * The loop would hit its cap at 60 or 70 found, correctly report that it had
 * not saturated, and then fan out only what it had.
 *
 * One round per five expected entities, floored at the old value so small
 * campaigns behave exactly as before, and capped so this can never become
 * unbounded.
 */
export function discoveryStepLimit(targetCount: number | null | undefined, alreadyDiscovered = 0) {
  if (targetCount === null || targetCount === undefined) return 15;
  const remaining = Math.max(0, targetCount - alreadyDiscovered);
  return Math.max(15, Math.min(MAX_STEPS_HARD_LIMIT, Math.ceil(remaining / 5) + 5));
}

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
  const steering: string[] = [];
  const maxSteps = discoveryStepLimit(payload.targetCount, payload.alreadyDiscovered);

  for (let step = 0; step < maxSteps; step++) {
    const budget = await readBudget(payload, deps);
    if (budget.exhausted) {
      stopReason = `${budget.reason} Discovery stopped before finishing.`;
      break;
    }

    // Steering is picked up between rounds, not mid-round. A directive
    // therefore changes the next query the model chooses while everything
    // already discovered stays exactly as it is - which is the whole point of
    // steering rather than restarting.
    const steer = await readSteering(payload, deps, "scouting");
    if (steer.directives.length > 0) {
      steering.push(...steer.directives.map((directive) => directive.summary));
      messages.push({ role: "user", content: steeringMessage(steer.directives) });
    }
    if (steer.stopDiscovery) {
      stopReason = "Discovery stopped on request. Everything found so far is kept.";
      saturated = true;
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
    stopReason = `Reached the ${maxSteps}-step discovery limit before saturating. ` +
      "Continuing the campaign resumes discovery without rediscovering anything.";
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
    duplicates: finalCoverage?.duplicates ?? 0,
    steering
  };
}

type AbsorbedDirective = { kind: string; instruction: string; summary: string };

/** Mirrors the steering_poll response in app/api/internal/workflow/route.ts. */
type SteeringSnapshot = {
  directives?: Array<{ kind?: string; instruction?: string }>;
  stopDiscovery?: boolean;
  qualificationRules?: string[];
};

/**
 * Reads any directive a person has written since the last round.
 *
 * Unlike the budget check, this fails *open*. An unreachable steering poll
 * means nobody has steered as far as this loop can tell, and stopping a
 * campaign because an optional instruction channel was briefly unavailable
 * would be a worse failure than missing a nudge for one round - the directive
 * stays pending and is picked up next round either way.
 */
async function readSteering(
  payload: { runId: string; campaignId: string },
  deps: { callWorkflowApp: typeof callWorkflowApp },
  stage: "scouting" | "dossier"
): Promise<{ directives: AbsorbedDirective[]; stopDiscovery: boolean; qualificationRules: string[] }> {
  try {
    const snapshot = await deps.callWorkflowApp<SteeringSnapshot>({
      action: "steering_poll",
      runId: payload.runId,
      campaignId: payload.campaignId,
      stage
    });
    const directives = (snapshot?.directives ?? []).map((directive) => {
      const kind = String(directive.kind ?? "refocus");
      const instruction = String(directive.instruction ?? "");
      return { kind, instruction, summary: instruction ? `${kind}: ${instruction}` : kind };
    });
    return {
      directives,
      stopDiscovery: snapshot?.stopDiscovery === true,
      qualificationRules: snapshot?.qualificationRules ?? []
    };
  } catch {
    return { directives: [], stopDiscovery: false, qualificationRules: [] };
  }
}

function steeringMessage(directives: AbsorbedDirective[]) {
  return [
    "Updated instructions from the operator. Apply these from now on.",
    "Keep everything already found - this redirects the search, it does not restart it.",
    ...directives.map((directive) => `- ${directive.summary}`)
  ].join("\n");
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
        campaignId: payload.campaignId,
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

const DOSSIER_SEARCH_STEPS = 10;

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

  // Absorbed before claiming, not after. A worker that has not claimed yet is
  // a worker whose entity nobody has started, so applying a new criterion here
  // is what makes "steering governs work not yet begun" true; a worker already
  // past this point finishes its entity under the rules it started with, which
  // is why steering never leaves a half-written dossier. The host also
  // persists any added criterion onto the campaign, so it reaches siblings
  // that polled before it was written.
  const steer = await readSteering(payload, deps, "dossier");
  const qualificationRules = steer.qualificationRules.length > 0
    ? steer.qualificationRules
    : payload.qualificationRules;

  const claim = await deps.callWorkflowApp<{
    claimed: boolean;
    leaseToken: string | null;
    contextSnapshot: { id: string; context: Record<string, unknown> } | null;
  }>({
    action: "dossier_claim",
    runId: payload.runId,
    projectId: payload.projectId,
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
  const frozen = claim.contextSnapshot?.context as {
    candidate?: { data?: Record<string, unknown> };
    campaign?: { qualificationRules?: string[]; documentTemplate?: string; entitySchema?: EntityFieldSchema[] };
    strategy?: { strategy?: { evidenceCapabilities?: EvidenceCapability[] } };
  } | undefined;
  const candidateData = frozen?.candidate?.data ?? payload.candidateData;
  const frozenRules = frozen?.campaign?.qualificationRules;
  const effectiveRules = frozenRules && frozenRules.length > 0 ? frozenRules : qualificationRules;
  const documentTemplate = frozen?.campaign?.documentTemplate || payload.documentTemplate;
  const entitySchema = frozen?.campaign?.entitySchema?.length ? frozen.campaign.entitySchema : payload.entitySchema;
  const effectivePayload = { ...payload, candidateData, qualificationRules: effectiveRules, documentTemplate, entitySchema };
  const label = entityLabel(candidateData);

  try {
    const evidence = await gatherDossierEvidence(
      effectivePayload,
      deps,
      label,
      frozen?.strategy?.strategy?.evidenceCapabilities
    );

    const extraction = await deps.requestModel("worker_structured", [
      {
        role: "system",
        content: [
          "Fill in the declared fields for one entity from the supplied evidence.",
          `Fields: ${JSON.stringify(entitySchema)}.`,
          effectiveRules.length > 0
            ? `The entity qualifies only if: ${effectiveRules.join("; ")}.`
            : "No extra qualification rules beyond the field descriptions.",
          'Return JSON only: {"qualifies":true|false,"reason":"string","fields":{"field_name":"value"}}.',
          "Omit any field the evidence does not support. Never guess a value to fill a gap - an " +
            "absent field is a usable fact, an invented one is not."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({ knownSoFar: candidateData, frozenStrategy: frozen?.strategy ?? null, evidence })
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

    const merged = { ...candidateData, ...extracted.fields };
    const writeUp = await deps.requestModel("worker_writing", [
      {
        role: "system",
        content: [
          "Write one markdown document about a single entity, following the supplied template.",
          "Template:",
          documentTemplate,
          "Use only the supplied fields and evidence. Where the template asks for something the " +
            "evidence does not cover, write that it is not established rather than filling the gap.",
          "Prioritize verified public contact information for relevant decision-makers. Include names, current titles, role relevance, and publicly published professional or business contact routes when supported. Never infer an email address or include private personal data.",
          "Cite every material factual claim with an adjacent descriptive Markdown hyperlink, for example [OpenDART filing](https://example.com). Never print a bare full URL. Make every source-index entry a Markdown hyperlink and include its date.",
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
  label: string,
  evidenceCapabilities?: EvidenceCapability[]
): Promise<unknown[]> {
  const evidence: unknown[] = [];
  try {
    const { result } = await deps.callWorkflowApp<{ result: unknown }>({
      action: "official_company_enrichment",
      runId: payload.runId,
      projectId: payload.projectId,
      campaignId: payload.campaignId,
      candidateId: payload.candidateId,
      company: payload.candidateData,
      evidenceCapabilities
    });
    evidence.push({ sourceRole: "official_registry_enrichment", result });
  } catch (error) {
    evidence.push({ sourceRole: "official_registry_enrichment", error: error instanceof Error ? error.message : "official registry research failed" });
  }
  const useOfficialWebsite = !evidenceCapabilities?.length || evidenceCapabilities.includes("official_website");
  const officialDomain = useOfficialWebsite
    ? [payload.candidateData.website, payload.candidateData.domain]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined;
  if (officialDomain) {
    try {
      const { result } = await deps.callWorkflowApp<{ result: unknown }>({
        action: "official_site_research",
        runId: payload.runId,
        projectId: payload.projectId,
        campaignId: payload.campaignId,
        candidateId: payload.candidateId,
        domain: officialDomain,
        maxPages: 8
      });
      evidence.push({ sourceRole: "official_company_site", result });
    } catch (error) {
      evidence.push({ sourceRole: "official_company_site", error: error instanceof Error ? error.message : "official-site research failed" });
    }
  }
  const planned = await deps.requestModel("worker_structured", [
    {
      role: "system",
      content: [
        `Plan up to ${DOSSIER_SEARCH_STEPS} web searches to research one specific entity in depth.`,
        `Fields that need supporting evidence: ${JSON.stringify(payload.entitySchema)}.`,
        "Cover official identity, products and markets, leadership, HR and hiring, recent news, financial or growth signals, risks, and plausible service opportunities.",
        "Prioritize queries that verify the relevant buyer or sponsor, current title, public professional profile, and official business contact routes. Search official team/contact pages and public professional sources. Never infer email addresses or seek private personal contact data.",
        "Prefer official pages, filings, government records, reputable news, and public professional sources; use distinct queries rather than repeating the same result set.",
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

  for (const query of queries.slice(0, DOSSIER_SEARCH_STEPS)) {
    try {
      const { result } = await deps.callWorkflowApp<{ result: unknown }>({
        action: "scouting_search",
        runId: payload.runId,
        projectId: payload.projectId,
        agendaId: payload.agendaId,
        // Passing both ids is what lets the host answer from the campaign's
        // evidence pool instead of paying for a lookup a sibling worker
        // already made, and attribute the result when it does pay.
        campaignId: payload.campaignId,
        candidateId: payload.candidateId,
        query: query.slice(0, 2000)
      });
      evidence.push({ sourceRole: "external_verification", result });
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
