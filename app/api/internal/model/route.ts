import { NextResponse } from "next/server";
import { z } from "zod";
import { requestLiteLLM } from "@/lib/ai/litellm";
import { parseJson } from "@/lib/http";
import { isValidWorkflowRequest } from "@/lib/internal-auth";
import { repository } from "@/lib/repository";

const schema = z.object({
  model: z.enum([
    "executive_reasoning",
    "executive_review",
    "worker_research",
    "worker_structured",
    "worker_fast"
  ]),
  messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().min(1).max(100000)
  })).min(1).max(100),
  runId: z.string().uuid().optional()
});

export async function POST(request: Request) {
  if (!isValidWorkflowRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const startedAt = Date.now();
  try {
    const response = await requestLiteLLM(parsed.data.model, parsed.data.messages);
    if (parsed.data.runId) {
      const payload = response as {
        model?: string;
        provider?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        _hidden_params?: { response_cost?: number; fallback_reason?: string };
      };
      const cost = payload.usage?.cost ?? payload._hidden_params?.response_cost ?? 0;
      await repository.recordModelCall({
        runId: parsed.data.runId,
        route: parsed.data.model,
        model: payload.model ?? null,
        provider: payload.provider ?? null,
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
        costMicros: Math.max(0, Math.round(cost * 1_000_000)),
        latencyMs: Date.now() - startedAt,
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
        error: reason instanceof Error ? reason.message : "Model request failed."
      });
    }
    throw reason;
  }
}
