import { afterEach, describe, expect, it, vi } from "vitest";
import { modelRoutePolicies, modelRequestSchema, resolveModelPolicy } from "@/lib/ai/model-policy";
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
    expect(modelRoutePolicies.worker_research.candidates.map((item) => item.provider))
      .toEqual(["openrouter"]);
  });

  it("resolves production workers only through an approved paid model", () => {
    vi.stubEnv("NODE_ENV", "production");
    const worker = resolveModelPolicy("worker_research");
    expect(worker.candidates).toHaveLength(1);
    expect(worker.candidates[0]).toMatchObject({
      modelEnv: "WORKER_MODEL", pricingClass: "paid", productionApproved: true
    });
    expect(resolveModelPolicy("executive_reasoning").candidates).toHaveLength(1);
  });

  it("cannot promote NVIDIA into production while no NVIDIA candidate is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NVIDIA_PRODUCTION_APPROVED", "true");
    // The approval flag gates a candidate; it must not conjure one. The
    // existing approved OpenRouter worker remains the only candidate.
    expect(resolveModelPolicy("worker_research").candidates.map((item) => item.provider))
      .toEqual(["openrouter"]);
  });

  it("does not change the approved route when testing mode is enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_TESTING_MODELS", "true");
    const policy = resolveModelPolicy("worker_research");
    expect(policy.testingMode).toBe(true);
    expect(policy.candidates.map((candidate) => candidate.provider))
      .toEqual(["openrouter"]);
    expect(policy.candidates.every((candidate) => candidate.productionApproved)).toBe(true);
  });

  it("caps caller budgets at the route policy maximum", () => {
    expect(resolveModelPolicy("worker_fast", 999_999).maxCostMicros)
      .toBe(modelRoutePolicies.worker_fast.maxCostMicros);
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
