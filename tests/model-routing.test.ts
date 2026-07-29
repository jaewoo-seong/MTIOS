import { afterEach, describe, expect, it, vi } from "vitest";
import { modelRoutePolicies, modelRequestSchema, resolveModelPolicy } from "@/lib/ai/model-policy";
import { workerCatalog } from "@/lib/workflows/contracts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("model routing policy", () => {
  it("defines role-specific routes with explicit budgets and candidates", () => {
    expect(modelRoutePolicies.worker_research.purpose).toMatch(/research/i);
    expect(modelRoutePolicies.worker_translation.purpose).toMatch(/translation/i);
    expect(modelRoutePolicies.multilingual_embedding.maxCostMicros).toBeGreaterThan(0);
    expect(modelRoutePolicies.worker_research.candidates.map((item) => item.provider))
      .toEqual(["nvidia", "openrouter"]);
  });

  it("keeps testing-only free providers out of production resolution", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => resolveModelPolicy("worker_research")).toThrow(/production-approved/i);
    expect(resolveModelPolicy("executive_reasoning").candidates).toHaveLength(1);
  });

  it("allows NVIDIA production promotion only through an explicit approval gate", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NVIDIA_PRODUCTION_APPROVED", "true");
    expect(resolveModelPolicy("worker_research").candidates[0].provider).toBe("nvidia");
  });

  it("allows testing-only candidates through an explicit production test gate", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_TESTING_MODELS", "true");
    const policy = resolveModelPolicy("worker_research");
    expect(policy.testingMode).toBe(true);
    expect(policy.candidates.map((candidate) => candidate.provider))
      .toEqual(["nvidia", "openrouter"]);
    expect(policy.candidates.every((candidate) =>
      candidate.licensingStatus === "testing_only"
    )).toBe(true);
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
