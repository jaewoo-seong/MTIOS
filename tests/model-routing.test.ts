import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inferTaskProfile, modelRoutePolicies, modelRequestSchema,
  rankModelCandidates, resolveModelPolicy
} from "@/lib/ai/model-policy";
import { extractToolCalls } from "@/lib/ai/litellm";
import { workerCatalog } from "@/lib/workflows/contracts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("model routing policy", () => {
  it("defines role-specific routes with explicit budgets and candidates", () => {
    expect(modelRoutePolicies.worker_research.purpose).toMatch(/research/i);
    expect(modelRoutePolicies.worker_translation.purpose).toMatch(/translation/i);
    expect(modelRoutePolicies.multilingual_embedding.maxCostMicros).toBeGreaterThan(0);
    // OpenRouter only: the NVIDIA candidate was removed along with its LiteLLM
    // entries, so nothing lists a provider that cannot serve a request.
    expect(modelRoutePolicies.worker_research.candidates.length).toBeGreaterThan(2);
    expect(modelRoutePolicies.worker_research.candidates.every((item) => item.provider === "openrouter")).toBe(true);
  });

  it("resolves production workers through an approved free OpenRouter model", () => {
    vi.stubEnv("NODE_ENV", "production");
    const worker = resolveModelPolicy("worker_research");
    expect(worker.candidates.length).toBeGreaterThan(2);
    expect(worker.candidates[0]).toMatchObject({
      modelEnv: "OPENROUTER_FREE_RESEARCH_MODEL", gatewayModel: "auto:free_research_nemotron",
      pricingClass: "free", productionApproved: true
    });
    expect(resolveModelPolicy("executive_reasoning").candidates).toHaveLength(1);
  });

  it("keeps every lightweight worker route on free models", () => {
    const workerRoutes = [
      "worker_research", "worker_creative", "worker_writing", "worker_editing",
      "worker_structured", "worker_translation", "worker_fast"
    ] as const;
    for (const route of workerRoutes) {
      expect(modelRoutePolicies[route].candidates.length).toBeGreaterThan(0);
      expect(modelRoutePolicies[route].candidates.every((candidate) => candidate.pricingClass === "free"))
        .toBe(true);
    }
  });

  it("cannot promote NVIDIA into production while no NVIDIA candidate is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NVIDIA_PRODUCTION_APPROVED", "true");
    // The approval flag gates a candidate; it must not conjure one. The
    // existing approved OpenRouter worker remains the only candidate.
    expect(resolveModelPolicy("worker_research").candidates.every((item) => item.provider === "openrouter"))
      .toBe(true);
  });

  it("does not change the approved route when testing mode is enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_TESTING_MODELS", "true");
    const policy = resolveModelPolicy("worker_research");
    expect(policy.testingMode).toBe(true);
    expect(policy.candidates.every((candidate) => candidate.provider === "openrouter"))
      .toBe(true);
    expect(policy.candidates.every((candidate) => candidate.productionApproved)).toBe(true);
  });

  it("caps caller budgets at the route policy maximum", () => {
    expect(resolveModelPolicy("worker_fast", 999_999).maxCostMicros)
      .toBe(modelRoutePolicies.worker_fast.maxCostMicros);
  });

  it("selects a multilingual model for Korean editing and a long-context model for dossier writing", () => {
    const editing = inferTaskProfile("worker_editing", [{ content: "한국어 문서를 자연스럽게 수정하세요." }]);
    const editingRanked = rankModelCandidates(modelRoutePolicies.worker_editing, editing);
    expect(editingRanked[0].candidate.gatewayModel).toContain("gemma_multilingual");

    const writing = inferTaskProfile("worker_writing", [{ content: "Write a complete long-form company dossier." }], {
      expectedOutput: "long", factuality: "high"
    });
    const writingRanked = rankModelCandidates(modelRoutePolicies.worker_writing, writing);
    expect(writingRanked[0].candidate.longContext).toBe(true);
  });

  it("validates supported chat routes and structured-output controls", () => {
    expect(modelRequestSchema.parse({
      model: "worker_creative",
      messages: [{ role: "user", content: "Generate options." }],
      structuredOutput: true
    }).model).toBe("worker_creative");
  });

  it("maps specialized workers to specialized routes", () => {
    expect(workerCatalog.ideation.modelRoute).toBe("worker_creative");
    expect(workerCatalog.content_writing.modelRoute).toBe("worker_writing");
    expect(workerCatalog.translation.modelRoute).toBe("worker_translation");
  });
});

describe("Stage 0 - Tool Bridge", () => {
  it("still requires content on plain system and user messages", () => {
    expect(() => modelRequestSchema.parse({
      model: "worker_research",
      messages: [{ role: "user", content: "" }]
    })).toThrow();
  });

  it("accepts an assistant message that only carries tool_calls, no content", () => {
    const parsed = modelRequestSchema.parse({
      model: "worker_research",
      messages: [
        { role: "user", content: "Find recent Kickstarter hardware campaigns." },
        {
          role: "assistant",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "search_web", arguments: '{"query":"kickstarter hardware 2026"}' }
          }]
        }
      ]
    });
    expect(parsed.messages[1]).toMatchObject({ role: "assistant" });
  });

  it("accepts a tool-result message feeding a call's output back", () => {
    const parsed = modelRequestSchema.parse({
      model: "worker_research",
      messages: [
        { role: "user", content: "Find recent Kickstarter hardware campaigns." },
        { role: "tool", tool_call_id: "call_1", content: "[]" }
      ]
    });
    expect(parsed.messages[1]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
  });

  it("validates tool definitions passed alongside a request", () => {
    const parsed = modelRequestSchema.parse({
      model: "worker_research",
      messages: [{ role: "user", content: "Find candidates." }],
      tools: [{
        type: "function",
        function: {
          name: "search_web",
          description: "Search the web for candidate companies.",
          parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
        }
      }]
    });
    expect(parsed.tools?.[0].function.name).toBe("search_web");
  });

  it("rejects a tool call whose function block is missing required fields", () => {
    expect(() => modelRequestSchema.parse({
      model: "worker_research",
      messages: [{
        role: "assistant",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "search_web" } }]
      }]
    })).toThrow();
  });
});

describe("extractToolCalls", () => {
  it("returns the tool calls a model requested", () => {
    const response = {
      choices: [{
        message: {
          tool_calls: [{
            id: "call_1",
            type: "function" as const,
            function: { name: "search_web", arguments: '{"query":"x"}' }
          }]
        }
      }]
    };
    expect(extractToolCalls(response)).toHaveLength(1);
    expect(extractToolCalls(response)[0].function.name).toBe("search_web");
  });

  it("returns an empty array when the model returned plain content instead", () => {
    const response = { choices: [{ message: { content: "no tool needed" } }] };
    expect(extractToolCalls(response)).toEqual([]);
  });

  it("returns an empty array for a malformed or missing response shape", () => {
    expect(extractToolCalls({})).toEqual([]);
    expect(extractToolCalls(null)).toEqual([]);
    expect(extractToolCalls(undefined)).toEqual([]);
  });
});
