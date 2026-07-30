import { describe, expect, it, vi } from "vitest";
import {
  runDossierLoop,
  runScoutingLoop,
  type DossierPayload,
  type ScoutingPayload
} from "@/trigger/collection-agent";
import type { ToolCall } from "@/lib/ai/litellm";
import type { callWorkflowApp as CallWorkflowApp } from "@/lib/workflows/callback";

function chatResponse(content: string | null, toolCalls: ToolCall[] = []) {
  return { choices: [{ message: { content, tool_calls: toolCalls } }] };
}

function searchCall(id: string, query: string): ToolCall {
  return { id, type: "function", function: { name: "search_web", arguments: JSON.stringify({ query }) } };
}

function recordCall(id: string, candidates: Array<Record<string, unknown>>): ToolCall {
  return { id, type: "function", function: { name: "record_candidates", arguments: JSON.stringify({ candidates }) } };
}

const payload: ScoutingPayload = {
  runId: "11111111-1111-4111-8111-111111111111",
  campaignId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  agendaId: "44444444-4444-4444-8444-444444444444",
  entitySchema: [{ name: "companyName", description: "Company name" }],
  qualificationRules: ["Actively fundraising"],
  discoveryQueries: ["site:kickstarter.com hardware"]
};

const AFFORDABLE = { ceilingCents: 500, spentCents: 0, remainingCents: 500, exhausted: false };

/**
 * Dispatches on action name rather than call order. Order-based mocks tie
 * every test to the exact sequence of workflow calls the loop happens to
 * make, so adding one call - like the budget check - breaks tests that were
 * never about it.
 */
function scoutingHarness(options: {
  record?: (call: number) => unknown;
  search?: () => unknown;
  budget?: unknown;
  coverage?: unknown;
} = {}) {
  const calls: Array<Record<string, unknown>> = [];
  let recordCalls = 0;
  const callWorkflowApp = vi.fn(async (body: Record<string, unknown>) => {
    calls.push(body);
    if (body.action === "collection_budget") return options.budget ?? AFFORDABLE;
    if (body.action === "scouting_conclude") {
      return { coverage: options.coverage ?? { discovered: 0, duplicates: 0, remaining: null } };
    }
    if (body.action === "scouting_search") {
      if (options.search) return options.search();
      return { result: { evidence: [{ title: "Example Co" }] } };
    }
    if (body.action === "scouting_record") {
      recordCalls += 1;
      return options.record
        ? options.record(recordCalls)
        : { outcomes: [{ resolution: "new" }], coverage: { discovered: 1, duplicates: 0, remaining: 99 } };
    }
    return {};
  }) as unknown as typeof CallWorkflowApp;
  return { callWorkflowApp, calls };
}

describe("Stage 3 - Scouting Loop", () => {
  it("stops as soon as the model returns no further tool calls", async () => {
    const requestModel = vi.fn().mockResolvedValue(chatResponse("Nothing more to find."));
    const { callWorkflowApp } = scoutingHarness();

    const result = await runScoutingLoop(payload, { requestModel, callWorkflowApp });

    expect(requestModel).toHaveBeenCalledTimes(1);
    expect(result.saturated).toBe(true);
    expect(result.stopReason).toMatch(/Nothing more to find/);
    expect(callWorkflowApp).toHaveBeenCalledWith(expect.objectContaining({ action: "scouting_conclude", saturated: true }));
  });

  it("executes a search_web call through callWorkflowApp, not a direct MCP import", async () => {
    const requestModel = vi.fn()
      .mockResolvedValueOnce(chatResponse(null, [searchCall("c1", "kickstarter hardware 2026")]))
      .mockResolvedValueOnce(chatResponse("Done searching."));
    const { callWorkflowApp } = scoutingHarness();

    await runScoutingLoop(payload, { requestModel, callWorkflowApp });

    expect(callWorkflowApp).toHaveBeenCalledWith(expect.objectContaining({
      action: "scouting_search",
      projectId: payload.projectId,
      agendaId: payload.agendaId,
      query: "kickstarter hardware 2026"
    }));
  });

  it("stops once the target count is reached", async () => {
    const requestModel = vi.fn()
      .mockResolvedValue(chatResponse(null, [recordCall("c1", [{ companyName: "Acme" }])]));
    const reached = { discovered: 10, duplicates: 0, remaining: 0 };
    const { callWorkflowApp } = scoutingHarness({
      record: () => ({ outcomes: [{ resolution: "new" }], coverage: reached }),
      coverage: reached
    });

    const result = await runScoutingLoop(payload, { requestModel, callWorkflowApp });

    expect(result.saturated).toBe(true);
    expect(result.stopReason).toMatch(/Target count reached/);
    expect(result.discovered).toBe(10);
  });

  it("stops after several consecutive rounds with no new candidates", async () => {
    const requestModel = vi.fn()
      .mockResolvedValue(chatResponse(null, [recordCall("dup", [{ companyName: "Already Known" }])]));
    const { callWorkflowApp } = scoutingHarness({
      record: () => ({
        outcomes: [{ resolution: "duplicate" }],
        coverage: { discovered: 5, duplicates: 3, remaining: 95 }
      })
    });

    const result = await runScoutingLoop(payload, { requestModel, callWorkflowApp });

    expect(requestModel).toHaveBeenCalledTimes(3);
    expect(result.saturated).toBe(true);
    expect(result.stopReason).toMatch(/No new distinct entities across 3 consecutive rounds/);
  });

  it("resets the empty-round counter as soon as a round finds something new", async () => {
    const requestModel = vi.fn()
      .mockResolvedValue(chatResponse(null, [recordCall("c1", [{ companyName: "Whatever" }])]));
    const dup = { outcomes: [{ resolution: "duplicate" }], coverage: { discovered: 1, duplicates: 1, remaining: 99 } };
    const fresh = { outcomes: [{ resolution: "new" }], coverage: { discovered: 2, duplicates: 1, remaining: 98 } };
    // Rounds 1-2 duplicate, round 3 fresh (resets), rounds 4-6 duplicate again.
    const { callWorkflowApp } = scoutingHarness({ record: (call) => (call === 3 ? fresh : dup) });

    const result = await runScoutingLoop(payload, { requestModel, callWorkflowApp });

    expect(requestModel).toHaveBeenCalledTimes(6);
    expect(result.saturated).toBe(true);
  });

  it("stops at the step cap without claiming the campaign is saturated", async () => {
    const requestModel = vi.fn().mockResolvedValue(chatResponse(null, [searchCall("c1", "query")]));
    const { callWorkflowApp } = scoutingHarness({ search: () => ({ result: { evidence: [] } }) });

    const result = await runScoutingLoop(payload, { requestModel, callWorkflowApp });

    expect(requestModel).toHaveBeenCalledTimes(15); // MAX_STEPS
    expect(result.saturated).toBe(false);
    expect(result.stopReason).toMatch(/15-step discovery limit/);
    expect(callWorkflowApp).toHaveBeenCalledWith(expect.objectContaining({ action: "scouting_conclude", saturated: false }));
  });

  it("reports a search failure back to the model instead of crashing the loop", async () => {
    const requestModel = vi.fn()
      .mockResolvedValueOnce(chatResponse(null, [searchCall("c1", "query")]))
      .mockResolvedValueOnce(chatResponse("Stopping after the search failed."));
    const { callWorkflowApp } = scoutingHarness({
      search: () => { throw new Error("provider unavailable"); }
    });

    const result = await runScoutingLoop(payload, { requestModel, callWorkflowApp });

    expect(result.stopReason).toMatch(/Stopping after the search failed/);
    // The second call to requestModel should have received the error as a tool result, not thrown.
    const secondCallMessages = requestModel.mock.calls[1][1];
    const toolMessage = secondCallMessages.find((message: { role: string }) => message.role === "tool");
    expect(toolMessage.content).toContain("provider unavailable");
  });

  it("tells the model about an unknown tool name instead of crashing", async () => {
    const bogusCall: ToolCall = { id: "c1", type: "function", function: { name: "delete_everything", arguments: "{}" } };
    const requestModel = vi.fn()
      .mockResolvedValueOnce(chatResponse(null, [bogusCall]))
      .mockResolvedValueOnce(chatResponse("Stopping."));
    const { callWorkflowApp } = scoutingHarness();

    await runScoutingLoop(payload, { requestModel, callWorkflowApp });

    const secondCallMessages = requestModel.mock.calls[1][1];
    const toolMessage = secondCallMessages.find((message: { role: string }) => message.role === "tool");
    expect(toolMessage.content).toContain("Unknown tool");
  });

  it("ignores malformed candidate entries instead of recording garbage", async () => {
    // Simulate the model sending non-object entries.
    const malformedCall: ToolCall = {
      id: "c1", type: "function",
      function: { name: "record_candidates", arguments: JSON.stringify({ candidates: ["not an object", null, 42] }) }
    };
    const requestModel = vi.fn()
      .mockResolvedValueOnce(chatResponse(null, [malformedCall]))
      .mockResolvedValueOnce(chatResponse("Stopping."));
    const { callWorkflowApp } = scoutingHarness();

    await runScoutingLoop(payload, { requestModel, callWorkflowApp });

    // No scouting_record call should have been made - every candidate was junk.
    expect(callWorkflowApp).not.toHaveBeenCalledWith(expect.objectContaining({ action: "scouting_record" }));
  });
});

describe("Guardrails - campaign spend ceiling", () => {
  it("stops discovery when the ceiling is reached, without calling it saturated", async () => {
    const requestModel = vi.fn().mockResolvedValue(chatResponse(null, [searchCall("c1", "query")]));
    const { callWorkflowApp } = scoutingHarness({
      budget: { ceilingCents: 500, spentCents: 512, remainingCents: 0, exhausted: true }
    });

    const result = await runScoutingLoop(payload, { requestModel, callWorkflowApp });

    // Checked before the first model call, so an exhausted budget spends nothing.
    expect(requestModel).not.toHaveBeenCalled();
    expect(result.saturated).toBe(false);
    expect(result.stopReason).toMatch(/spend ceiling reached \(512 of 500 cents\)/);
    expect(callWorkflowApp).toHaveBeenCalledWith(expect.objectContaining({
      action: "scouting_conclude", saturated: false
    }));
  });

  it("fails closed when the budget cannot be read, rather than spending unchecked", async () => {
    const requestModel = vi.fn().mockResolvedValue(chatResponse(null, [searchCall("c1", "query")]));
    const callWorkflowApp = vi.fn(async (body: Record<string, unknown>) => {
      if (body.action === "collection_budget") throw new Error("ledger unreachable");
      if (body.action === "scouting_conclude") return { coverage: null };
      return {};
    }) as unknown as typeof CallWorkflowApp;

    const result = await runScoutingLoop(payload, { requestModel, callWorkflowApp });

    expect(requestModel).not.toHaveBeenCalled();
    expect(result.saturated).toBe(false);
    expect(result.stopReason).toMatch(/could not be verified: ledger unreachable/);
  });

  it("treats a malformed budget response as unverified rather than as affordable", async () => {
    const requestModel = vi.fn().mockResolvedValue(chatResponse(null, [searchCall("c1", "query")]));
    const { callWorkflowApp } = scoutingHarness({ budget: { spentCents: 0 } });

    const result = await runScoutingLoop(payload, { requestModel, callWorkflowApp });

    expect(requestModel).not.toHaveBeenCalled();
    expect(result.stopReason).toMatch(/could not be verified/);
  });

  it("leaves a candidate unclaimed when the budget is exhausted", async () => {
    const requestModel = vi.fn();
    const calls: Array<Record<string, unknown>> = [];
    const callWorkflowApp = vi.fn(async (body: Record<string, unknown>) => {
      calls.push(body);
      if (body.action === "collection_budget") {
        return { ceilingCents: 500, spentCents: 500, remainingCents: 0, exhausted: true };
      }
      return {};
    }) as unknown as typeof CallWorkflowApp;

    const result = await runDossierLoop(dossierPayload, { requestModel, callWorkflowApp });

    expect(result.status).toBe("budget_exhausted");
    expect(requestModel).not.toHaveBeenCalled();
    // Never claimed, so the candidate stays plainly pending instead of sitting
    // behind a lease no worker is servicing.
    expect(calls.some((call) => call.action === "dossier_claim")).toBe(false);
    expect(calls.some((call) => call.action === "dossier_result")).toBe(false);
  });
});

const dossierPayload: DossierPayload = {
  runId: "11111111-1111-4111-8111-111111111111",
  campaignId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  agendaId: "44444444-4444-4444-8444-444444444444",
  candidateId: "55555555-5555-4555-8555-555555555555",
  candidateData: { companyName: "Acme Robotics" },
  entitySchema: [
    { name: "companyName", description: "Company name" },
    { name: "fundingGoal", description: "Stated funding goal" }
  ],
  documentTemplate: "# Profile\n## Overview\n## Fit",
  qualificationRules: ["Actively fundraising"]
};

/** A dossier deps pair whose workflow calls are driven by action name, not call order. */
function dossierDeps(options: {
  claimed?: boolean;
  planContent?: string;
  extractionContent?: string;
  writingContent?: string;
  searchThrows?: boolean;
}) {
  const calls: Array<Record<string, unknown>> = [];
  const callWorkflowApp = vi.fn(async (body: Record<string, unknown>) => {
    calls.push(body);
    if (body.action === "collection_budget") return AFFORDABLE;
    if (body.action === "dossier_claim") {
      const claimed = options.claimed ?? true;
      return { claimed, leaseToken: claimed ? "lease-1" : null };
    }
    if (body.action === "scouting_search") {
      if (options.searchThrows) throw new Error("provider unavailable");
      return { result: { evidence: [{ title: "Acme raises seed" }] } };
    }
    return { status: "ok" };
  }) as unknown as typeof CallWorkflowApp;

  const requestModel = vi.fn()
    .mockResolvedValueOnce(chatResponse(options.planContent ?? JSON.stringify({ queries: ["Acme Robotics funding"] })))
    .mockResolvedValueOnce(chatResponse(options.extractionContent ?? JSON.stringify({
      qualifies: true, reason: "Live campaign.", fields: { fundingGoal: "$50,000" }
    })))
    .mockResolvedValueOnce(chatResponse(options.writingContent ?? "# Acme Robotics\n## Overview\nBuilds arms."));

  return { requestModel, callWorkflowApp, calls };
}

describe("Stage 4 - Dossier Loop", () => {
  it("claims, researches, extracts, writes, and reports one completed dossier", async () => {
    const deps = dossierDeps({});

    const result = await runDossierLoop(dossierPayload, deps);

    expect(result).toMatchObject({ status: "completed", candidateId: dossierPayload.candidateId });
    const reported = deps.calls.find((call) => call.action === "dossier_result");
    expect(reported).toMatchObject({
      status: "completed",
      leaseToken: "lease-1",
      data: { fundingGoal: "$50,000" }
    });
    expect(String(reported!.markdown)).toContain("Acme Robotics");
  });

  it("skips a candidate another worker already claimed instead of researching it twice", async () => {
    const deps = dossierDeps({ claimed: false });

    const result = await runDossierLoop(dossierPayload, deps);

    expect(result.status).toBe("skipped");
    // No model spend and no result write on a candidate we do not hold.
    expect(deps.requestModel).not.toHaveBeenCalled();
    expect(deps.calls.some((call) => call.action === "dossier_result")).toBe(false);
  });

  it("disqualifies a candidate the evidence does not support, without writing a document", async () => {
    const deps = dossierDeps({
      extractionContent: JSON.stringify({
        qualifies: false, reason: "Campaign ended in 2019.", fields: { fundingGoal: "$0" }
      })
    });

    const result = await runDossierLoop(dossierPayload, deps);

    expect(result.status).toBe("disqualified");
    // Plan + extraction only - the writing call must never happen.
    expect(deps.requestModel).toHaveBeenCalledTimes(2);
    const reported = deps.calls.find((call) => call.action === "dossier_result");
    expect(reported).toMatchObject({ status: "disqualified" });
    expect(reported!.markdown).toBeUndefined();
  });

  it("uses two separate model calls so the writing step cannot invent unextracted facts", async () => {
    const deps = dossierDeps({});

    await runDossierLoop(dossierPayload, deps);

    const routes = deps.requestModel.mock.calls.map((call) => call[0]);
    expect(routes).toEqual(["worker_structured", "worker_structured", "worker_writing"]);
  });

  it("falls back to a single query when the search plan is malformed", async () => {
    const deps = dossierDeps({ planContent: "not json at all" });

    const result = await runDossierLoop(dossierPayload, deps);

    expect(result.status).toBe("completed");
    const searches = deps.calls.filter((call) => call.action === "scouting_search");
    expect(searches).toHaveLength(1);
    expect(searches[0].query).toBe("Acme Robotics");
  });

  it("caps the number of searches regardless of how many the model plans", async () => {
    const deps = dossierDeps({
      planContent: JSON.stringify({ queries: ["a", "b", "c", "d", "e", "f", "g"] })
    });

    await runDossierLoop(dossierPayload, deps);

    expect(deps.calls.filter((call) => call.action === "scouting_search")).toHaveLength(4);
  });

  it("still produces a dossier when a search fails, rather than failing the candidate", async () => {
    const deps = dossierDeps({ searchThrows: true });

    const result = await runDossierLoop(dossierPayload, deps);

    expect(result.status).toBe("completed");
  });

  it("records a failure and releases the lease when the writing step returns nothing", async () => {
    const deps = dossierDeps({ writingContent: "   " });

    const result = await runDossierLoop(dossierPayload, deps);

    expect(result.status).toBe("failed");
    // The lease must be released on the failure path too, or the candidate
    // stays locked until its lease expires.
    expect(deps.calls.find((call) => call.action === "dossier_result")).toMatchObject({
      status: "failed",
      leaseToken: "lease-1"
    });
  });

  it("records a failure when the extraction step returns a shape that does not validate", async () => {
    const deps = dossierDeps({ extractionContent: JSON.stringify({ reason: "no qualifies field" }) });

    const result = await runDossierLoop(dossierPayload, deps);

    expect(result.status).toBe("failed");
    expect(deps.calls.find((call) => call.action === "dossier_result")).toMatchObject({ status: "failed" });
  });
});
