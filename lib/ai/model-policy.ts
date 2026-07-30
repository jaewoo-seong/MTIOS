import { z } from "zod";
import type { ModelRoute } from "@/lib/ai/litellm";

export type ModelCandidate = {
  provider: "openrouter" | "nvidia";
  modelEnv: string;
  pricingClass: "paid" | "free";
  productionApproved: boolean;
  licensingStatus: "approved" | "testing_only" | "unverified";
};

export type ModelRoutePolicy = {
  purpose: string;
  maxCostMicros: number;
  structuredOutput: boolean;
  candidates: readonly ModelCandidate[];
};

const haiku: ModelCandidate = {
  provider: "openrouter",
  modelEnv: "EXECUTIVE_MODEL",
  pricingClass: "paid",
  productionApproved: true,
  licensingStatus: "approved"
};
const openRouterFree: ModelCandidate = {
  provider: "openrouter",
  modelEnv: "OPENROUTER_FREE_MODEL",
  pricingClass: "free",
  productionApproved: false,
  licensingStatus: "testing_only"
};

/**
 * OpenRouter only. The NVIDIA candidate was removed with its LiteLLM entries:
 * leaving it listed would have made evaluateFreeRoute check quota for a
 * provider that has no credentials and no reachable route, and shown a
 * provider in Settings that cannot serve a request.
 *
 * `provider` still admits "nvidia" so re-adding it is a one-line change.
 */
const workerCandidates = [openRouterFree] as const;

export const modelRoutePolicies: Record<ModelRoute, ModelRoutePolicy> = {
  executive_reasoning: { purpose: "Planning and clarification", maxCostMicros: 300_000, structuredOutput: true, candidates: [haiku] },
  executive_review: { purpose: "Quality and decision review", maxCostMicros: 250_000, structuredOutput: true, candidates: [haiku] },
  worker_research: { purpose: "Sourced research", maxCostMicros: 100_000, structuredOutput: true, candidates: workerCandidates },
  worker_creative: { purpose: "Creative ideation", maxCostMicros: 80_000, structuredOutput: true, candidates: workerCandidates },
  worker_writing: { purpose: "Long-form writing", maxCostMicros: 100_000, structuredOutput: false, candidates: workerCandidates },
  worker_editing: { purpose: "Editing", maxCostMicros: 60_000, structuredOutput: false, candidates: workerCandidates },
  worker_structured: { purpose: "Structured extraction", maxCostMicros: 80_000, structuredOutput: true, candidates: workerCandidates },
  worker_translation: { purpose: "English and Korean translation", maxCostMicros: 80_000, structuredOutput: false, candidates: workerCandidates },
  worker_fast: { purpose: "Fast classification", maxCostMicros: 30_000, structuredOutput: true, candidates: workerCandidates },
  // These two have no LiteLLM entry while OpenRouter is the only provider —
  // it serves no embedding models. Calls fail and retrieval falls back to
  // lexical scoring by design. The candidate list is kept non-empty because
  // the error path in app/api/internal/model/route.ts reads candidates[0];
  // it describes what WOULD serve the route, not something that works today.
  multilingual_embedding: { purpose: "Multilingual embeddings (unserved: no embedding provider configured)", maxCostMicros: 10_000, structuredOutput: false, candidates: workerCandidates },
  multilingual_reranking: { purpose: "Multilingual reranking (unserved: no reranking provider configured)", maxCostMicros: 20_000, structuredOutput: false, candidates: workerCandidates },
  premium_fallback: { purpose: "Admin-approved premium fallback", maxCostMicros: 300_000, structuredOutput: true, candidates: [haiku] }
};

const toolCallSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1).max(200),
    arguments: z.string().max(50000)
  })
});

/**
 * A discriminated shape, not one loose object: `assistant` may carry
 * `tool_calls` with no content (the model is still mid-turn), and `tool`
 * feeds one call's result back. Keeping `system`/`user` at `min(1)` content
 * preserves today's validation for every existing caller.
 */
const chatMessageSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.enum(["system", "user"]),
    content: z.string().min(1).max(100000)
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().max(100000).nullable().optional(),
    tool_calls: z.array(toolCallSchema).max(20).optional()
  }),
  z.object({
    role: z.literal("tool"),
    tool_call_id: z.string().min(1).max(200),
    content: z.string().max(100000)
  })
]);

const toolDefinitionSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    parameters: z.record(z.string(), z.unknown())
  })
});

export const modelRequestSchema = z.object({
  model: z.enum([
    "executive_reasoning", "executive_review", "worker_research",
    "worker_creative", "worker_writing", "worker_editing", "worker_structured",
    "worker_translation", "worker_fast"
  ]),
  messages: z.array(chatMessageSchema).min(1).max(100),
  runId: z.string().uuid().optional(),
  maxCostMicros: z.number().int().positive().max(1_000_000).optional(),
  structuredOutput: z.boolean().optional(),
  tools: z.array(toolDefinitionSchema).max(20).optional()
});

export function resolveModelPolicy(
  route: ModelRoute,
  requestedBudget?: number,
  configuredPolicy: ModelRoutePolicy = modelRoutePolicies[route]
) {
  const policy = configuredPolicy;
  const environment = process.env.NODE_ENV === "production" ? "production" : "development";
  const testingMode = process.env.ALLOW_TESTING_MODELS === "true";
  const explicitlyApproved = (candidate: ModelCandidate) =>
    candidate.provider === "nvidia" && process.env.NVIDIA_PRODUCTION_APPROVED === "true";
  const candidates = environment === "production"
    ? policy.candidates.filter((candidate) =>
        candidate.productionApproved || explicitlyApproved(candidate) ||
        (testingMode && candidate.licensingStatus === "testing_only")
      )
    : policy.candidates;
  if (candidates.length === 0) {
    throw new Error(`No production-approved model candidate for ${route}.`);
  }
  return {
    ...policy,
    environment,
    testingMode,
    candidates,
    maxCostMicros: Math.min(requestedBudget ?? policy.maxCostMicros, policy.maxCostMicros)
  };
}
