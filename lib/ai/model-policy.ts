import { z } from "zod";
import type { ModelRoute } from "@/lib/ai/litellm";

export type ModelCandidate = {
  provider: "openrouter" | "nvidia";
  modelEnv: string;
  /** LiteLLM alias. Unlike modelEnv, this is runtime-selectable from Settings. */
  gatewayModel: string;
  pricingClass: "paid" | "free";
  productionApproved: boolean;
  licensingStatus: "approved" | "testing_only" | "unverified";
  strengths?: readonly ModelTaskKind[];
  languages?: readonly ("en" | "ko")[];
  supportsStructuredOutput?: boolean;
  supportsTools?: boolean;
  longContext?: boolean;
};

export type ModelTaskKind =
  | "research" | "writing" | "editing" | "extraction" | "translation"
  | "classification" | "planning" | "review" | "creative";

export type ModelTaskProfile = {
  kind?: ModelTaskKind;
  languages?: Array<"en" | "ko">;
  structuredOutput?: boolean;
  toolCalling?: boolean;
  longContext?: boolean;
  expectedOutput?: "short" | "medium" | "long";
  factuality?: "standard" | "high";
};

export type ModelRoutePolicy = {
  purpose: string;
  maxCostMicros: number;
  structuredOutput: boolean;
  candidates: readonly ModelCandidate[];
};

const premiumExecutive: ModelCandidate = {
  provider: "openrouter",
  modelEnv: "EXECUTIVE_MODEL",
  gatewayModel: "executive_reasoning",
  pricingClass: "paid",
  productionApproved: true,
  licensingStatus: "approved"
};
const premiumFallback: ModelCandidate = { ...premiumExecutive, modelEnv: "PREMIUM_FALLBACK_MODEL", gatewayModel: "premium_fallback" };
const freeCandidate = (
  gatewayModel: string,
  modelEnv: string,
  capabilities: Pick<ModelCandidate, "strengths" | "languages" | "supportsStructuredOutput" | "supportsTools" | "longContext">
): ModelCandidate => ({
  provider: "openrouter",
  gatewayModel: `auto:${gatewayModel}`,
  modelEnv,
  pricingClass: "free",
  productionApproved: true,
  licensingStatus: "approved",
  ...capabilities
});

export const gatewayModelCatalog = [
  { gatewayModel: "free_research_nemotron", model: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super 120B · research/structured" },
  { gatewayModel: "free_longform_nemotron", model: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra 550B · long-form research" },
  { gatewayModel: "free_gemma_multilingual", model: "google/gemma-4-31b-it:free", label: "Gemma 4 31B · writing/translation/editing" },
  { gatewayModel: "free_gemma_structured", model: "google/gemma-4-26b-a4b-it:free", label: "Gemma 4 26B · structured output" },
  { gatewayModel: "free_fast_nemotron", model: "nvidia/nemotron-nano-9b-v2:free", label: "Nemotron Nano 9B · fast classification" }
] as const;

const research = freeCandidate("free_research_nemotron", "OPENROUTER_FREE_RESEARCH_MODEL", {
  strengths: ["research", "extraction", "review"], languages: ["en", "ko"],
  supportsStructuredOutput: true, supportsTools: true, longContext: true
});
const longform = freeCandidate("free_longform_nemotron", "OPENROUTER_FREE_LONGFORM_MODEL", {
  strengths: ["research", "writing", "review"], languages: ["en"],
  supportsStructuredOutput: true, supportsTools: false, longContext: true
});
const multilingual = freeCandidate("free_gemma_multilingual", "OPENROUTER_FREE_MULTILINGUAL_MODEL", {
  strengths: ["writing", "editing", "translation", "creative"], languages: ["en", "ko"],
  supportsStructuredOutput: false, supportsTools: false, longContext: false
});
const structured = freeCandidate("free_gemma_structured", "OPENROUTER_FREE_STRUCTURED_MODEL", {
  strengths: ["extraction", "classification", "research"], languages: ["en", "ko"],
  supportsStructuredOutput: true, supportsTools: false, longContext: false
});
const fast = freeCandidate("free_fast_nemotron", "OPENROUTER_FREE_FAST_MODEL", {
  strengths: ["classification", "extraction"], languages: ["en"],
  supportsStructuredOutput: true, supportsTools: false, longContext: false
});

export function resolveGatewayModel(gatewayModel: string) {
  return gatewayModel.startsWith("auto:") ? gatewayModel.slice(5) : gatewayModel;
}

export const modelRoutePolicies: Record<ModelRoute, ModelRoutePolicy> = {
  executive_reasoning: { purpose: "Planning and clarification", maxCostMicros: 300_000, structuredOutput: true, candidates: [premiumExecutive] },
  executive_review: { purpose: "Quality and decision review", maxCostMicros: 250_000, structuredOutput: true, candidates: [premiumExecutive] },
  worker_research: { purpose: "Sourced research", maxCostMicros: 100_000, structuredOutput: true, candidates: [research, longform, structured, multilingual, fast] },
  worker_creative: { purpose: "Creative ideation", maxCostMicros: 80_000, structuredOutput: false, candidates: [multilingual, longform, research] },
  worker_writing: { purpose: "Long-form writing", maxCostMicros: 100_000, structuredOutput: false, candidates: [longform, multilingual, research] },
  worker_editing: { purpose: "Editing", maxCostMicros: 60_000, structuredOutput: false, candidates: [multilingual, longform, research] },
  worker_structured: { purpose: "Structured extraction", maxCostMicros: 80_000, structuredOutput: true, candidates: [structured, research, fast, multilingual] },
  worker_translation: { purpose: "English and Korean translation", maxCostMicros: 80_000, structuredOutput: false, candidates: [multilingual, research, longform] },
  worker_fast: { purpose: "Fast classification", maxCostMicros: 30_000, structuredOutput: true, candidates: [fast, structured, research] },
  // These two have no LiteLLM entry while OpenRouter is the only provider —
  // it serves no embedding models. Calls fail and retrieval falls back to
  // lexical scoring by design. The candidate list is kept non-empty because
  // the error path in app/api/internal/model/route.ts reads candidates[0];
  // it describes what WOULD serve the route, not something that works today.
  multilingual_embedding: { purpose: "Multilingual embeddings (unserved: no embedding provider configured)", maxCostMicros: 10_000, structuredOutput: false, candidates: [fast] },
  multilingual_reranking: { purpose: "Multilingual reranking (unserved: no reranking provider configured)", maxCostMicros: 20_000, structuredOutput: false, candidates: [fast] },
  premium_fallback: { purpose: "Admin-approved premium fallback", maxCostMicros: 300_000, structuredOutput: true, candidates: [premiumFallback] }
};

const defaultKind: Partial<Record<ModelRoute, ModelTaskKind>> = {
  executive_reasoning: "planning", executive_review: "review",
  worker_research: "research", worker_creative: "creative", worker_writing: "writing",
  worker_editing: "editing", worker_structured: "extraction",
  worker_translation: "translation", worker_fast: "classification",
  premium_fallback: "planning"
};

export function inferTaskProfile(
  route: ModelRoute,
  messages: Array<{ content?: string | null }>,
  overrides: ModelTaskProfile = {}
): Required<ModelTaskProfile> {
  const content = messages.map((message) => message.content ?? "").join("\n");
  const korean = /[\uac00-\ud7af]/.test(content);
  return {
    kind: overrides.kind ?? defaultKind[route] ?? "research",
    languages: overrides.languages ?? (korean ? ["ko", "en"] : ["en"]),
    structuredOutput: overrides.structuredOutput ?? modelRoutePolicies[route].structuredOutput,
    toolCalling: overrides.toolCalling ?? false,
    longContext: overrides.longContext ?? content.length > 35_000,
    expectedOutput: overrides.expectedOutput ?? (["writing", "research"].includes(overrides.kind ?? defaultKind[route] ?? "") ? "long" : "medium"),
    factuality: overrides.factuality ?? (["research", "extraction", "review"].includes(overrides.kind ?? defaultKind[route] ?? "") ? "high" : "standard")
  };
}

export function rankModelCandidates(policy: ModelRoutePolicy, profile: Required<ModelTaskProfile>) {
  return policy.candidates.map((candidate, index) => {
    let score = 100 - index * 2;
    const reasons: string[] = [];
    if (candidate.strengths?.includes(profile.kind)) { score += 40; reasons.push(`specialized for ${profile.kind}`); }
    else score -= 12;
    if (profile.languages.every((language) => candidate.languages?.includes(language))) {
      score += profile.languages.includes("ko") ? 28 : 8;
      if (profile.languages.includes("ko")) reasons.push("supports Korean and English");
    } else score -= 80;
    if (profile.structuredOutput) {
      if (candidate.supportsStructuredOutput) { score += 24; reasons.push("supports structured output"); }
      else score -= 120;
    }
    if (profile.toolCalling) {
      if (candidate.supportsTools) { score += 30; reasons.push("supports tool calling"); }
      else score -= 140;
    }
    if (profile.longContext || profile.expectedOutput === "long") {
      if (candidate.longContext) { score += 18; reasons.push("suited to long context/output"); }
      else score -= 20;
    }
    return { candidate, score, reason: reasons.join(", ") || "eligible route fallback" };
  }).filter((item) => item.score >= 0).sort((left, right) => right.score - left.score);
}

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
  tools: z.array(toolDefinitionSchema).max(20).optional(),
  taskProfile: z.object({
    kind: z.enum(["research", "writing", "editing", "extraction", "translation", "classification", "planning", "review", "creative"]).optional(),
    languages: z.array(z.enum(["en", "ko"])).min(1).max(2).optional(),
    structuredOutput: z.boolean().optional(),
    toolCalling: z.boolean().optional(),
    longContext: z.boolean().optional(),
    expectedOutput: z.enum(["short", "medium", "long"]).optional(),
    factuality: z.enum(["standard", "high"]).optional()
  }).optional()
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
