import { NextResponse } from "next/server";
import { requestLiteLLM, type ModelRoute } from "@/lib/ai/litellm";
import { modelRequestSchema, resolveGatewayModel, resolveModelPolicy } from "@/lib/ai/model-policy";
import { parseJson } from "@/lib/http";
import { isValidWorkflowRequest } from "@/lib/internal-auth";
import { logModelCall, logger } from "@/lib/observability/logger";
import { repository } from "@/lib/repository";
import { getActiveModelPolicy } from "@/lib/settings";
import {
  approvedPremiumFallback,
  createPremiumApproval,
  evaluateFreeRoute,
  recordProviderUsage
} from "@/lib/ai/usage";

export async function POST(request: Request) {
  if (!isValidWorkflowRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = await parseJson(request, modelRequestSchema);
  if (parsed.error) return parsed.error;
  const startedAt = Date.now();
  const policy = resolveModelPolicy(
    parsed.data.model,
    parsed.data.maxCostMicros,
    await getActiveModelPolicy(parsed.data.model)
  );
  let selectedRoute: ModelRoute = parsed.data.model;
  let selectedCandidate = policy.candidates[0];
  if (parsed.data.runId && policy.candidates.some((candidate) => candidate.pricingClass === "free")) {
    const quota = await evaluateFreeRoute(parsed.data.model, policy.candidates);
    if (!quota.available) {
      const approved = await approvedPremiumFallback(parsed.data.runId, parsed.data.model);
      if (approved) {
        selectedRoute = "premium_fallback";
        selectedCandidate = resolveModelPolicy("premium_fallback").candidates[0];
      } else {
        const approval = await createPremiumApproval({
          runId: parsed.data.runId,
          route: parsed.data.model,
          maximumCostMicros: policy.maxCostMicros,
          reason: "All configured free providers reached quota or are unavailable."
        });
        // This is the state that silently parks a long campaign waiting for an
        // administrator, so it is worth a warn rather than only a database row.
        logger.warn("model.premium_approval_required", {
          runId: parsed.data.runId,
          route: parsed.data.model,
          approvalId: approval.id,
          reason: "free provider quota exhausted or unavailable"
        });
        return NextResponse.json({
          error: "premium_approval_required",
          approvalId: approval.id
        }, { status: 402 });
      }
    }
  }
  try {
    const structuredOutput = parsed.data.structuredOutput ?? policy.structuredOutput;
    const response = await requestLiteLLM(resolveGatewayModel(selectedCandidate.gatewayModel || selectedRoute), parsed.data.messages, {
      maxCostMicros: policy.maxCostMicros,
      responseFormat: structuredOutput ? { type: "json_object" } : undefined,
      tools: parsed.data.tools
    });
    if (parsed.data.runId) {
      const payload = response as {
        model?: string;
        provider?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] } }>;
        _hidden_params?: {
          response_cost?: number; fallback_reason?: string; api_base?: string;
          model_id?: string;
        };
      };
      const cost = payload.usage?.cost ?? payload._hidden_params?.response_cost ?? 0;
      const costMicros = Math.max(0, Math.round(cost * 1_000_000));
      if (costMicros > policy.maxCostMicros) {
        throw new Error(`Model call exceeded route budget for ${parsed.data.model}.`);
      }
      // A turn that ends in a tool call, not final content, isn't a
      // structured-output failure — it hasn't produced its answer yet.
      const requestedTool = (payload.choices?.[0]?.message?.tool_calls?.length ?? 0) > 0;
      let structuredOutputValid: boolean | null = null;
      if (structuredOutput && !requestedTool) {
        try {
          JSON.parse(payload.choices?.[0]?.message?.content ?? "");
          structuredOutputValid = true;
        } catch {
          structuredOutputValid = false;
        }
      }
      const selected = policy.candidates.find((candidate) =>
        candidate.provider === payload.provider
      ) ?? selectedCandidate;
      const recorded = await repository.recordModelCall({
        runId: parsed.data.runId,
        route: parsed.data.model,
        model: payload.model ?? null,
        provider: payload.provider ?? null,
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
        costMicros,
        latencyMs: Date.now() - startedAt,
        fallbackReason: payload._hidden_params?.fallback_reason ?? null,
        licensingStatus: selected.licensingStatus,
        environment: policy.environment,
        attemptCount: payload._hidden_params?.fallback_reason ? 2 : 1,
        structuredOutputValid,
        requestBudgetMicros: policy.maxCostMicros
      });
      await recordProviderUsage({
        runId: parsed.data.runId,
        modelCallId: recorded.id,
        provider: payload.provider ?? selected?.provider ?? "unknown",
        model: payload.model ?? null,
        route: parsed.data.model,
        projectId: recorded.projectId ?? null,
        userId: recorded.userId ?? null
      });
      // Logged in addition to being persisted. The table is the ledger of
      // record; the log line is what makes spend answerable without database
      // access, and survives when a run is deleted.
      logModelCall({
        runId: parsed.data.runId,
        route: parsed.data.model,
        model: payload.model ?? null,
        provider: payload.provider ?? null,
        costMicros,
        latencyMs: Date.now() - startedAt,
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
        fallbackReason: payload._hidden_params?.fallback_reason ?? null
      });
    }
    return NextResponse.json(response);
  } catch (reason) {
    if (parsed.data.runId) {
      await repository.recordModelCall({
        runId: parsed.data.runId,
        route: parsed.data.model,
        latencyMs: Date.now() - startedAt,
        licensingStatus: policy.candidates[0].licensingStatus,
        environment: policy.environment,
        requestBudgetMicros: policy.maxCostMicros,
        error: reason instanceof Error ? reason.message : "Model request failed."
      });
      if (selectedRoute !== "premium_fallback" &&
          policy.candidates.some((candidate) => candidate.pricingClass === "free")) {
        const approval = await createPremiumApproval({
          runId: parsed.data.runId,
          route: parsed.data.model,
          maximumCostMicros: policy.maxCostMicros,
          reason: reason instanceof Error
            ? `All free provider attempts failed: ${reason.message}`
            : "All free provider attempts failed."
        });
        return NextResponse.json({
          error: "premium_approval_required",
          approvalId: approval.id
        }, { status: 402 });
      }
    }
    throw reason;
  }
}
