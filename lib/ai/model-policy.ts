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
const nvidia: ModelCandidate = {
  provider: "nvidia",
  modelEnv: "NVIDIA_WORKER_MODEL",
  pricingClass: "free",
  productionApproved: false,
  licensingStatus: "testing_only"
};
const openRouterFree: ModelCandidate = {
  provider: "openrouter",
  modelEnv: "OPENROUTER_FREE_MODEL",
  pricingClass: "free",
  productionApproved: false,
  licensingStatus: "testing_only"
};

const workerCandidates = [nvidia, openRouterFree] as const;

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
  multilingual_embedding: { purpose: "Multilingual embeddings", maxCostMicros: 10_000, structuredOutput: false, candidates: workerCandidates },
  multilingual_reranking: { purpose: "Multilingual reranking", maxCostMicros: 20_000, structuredOutput: false, candidates: workerCandidates },
  premium_fallback: { purpose: "Admin-approved premium fallback", maxCostMicros: 300_000, structuredOutput: true, candidates: [haiku] }
};

export const modelRequestSchema = z.object({
  model: z.enum([
    "executive_reasoning", "executive_review", "worker_research",
    "worker_creative", "worker_writing", "worker_editing", "worker_structured",
    "worker_translation", "worker_fast"
  ]),
  messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().min(1).max(100000)
  })).min(1).max(100),
  runId: z.string().uuid().optional(),
  maxCostMicros: z.number().int().positive().max(1_000_000).optional(),
  structuredOutput: z.boolean().optional()
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
