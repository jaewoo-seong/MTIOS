import type { ModelTaskProfile } from "@/lib/ai/model-policy";
import { isUiAuditMode } from "@/lib/ui-audit-mode";

/**
 * OpenAI-compatible tool-calling shapes, passed through LiteLLM unchanged.
 * A tool's JSON Schema lives in `parameters`; LiteLLM forwards `tools`
 * verbatim to whichever provider backs a route, so this only works for
 * routes whose configured provider actually supports tool-calling.
 */
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/**
 * Exported so a tool-calling loop can build a conversation array with the
 * right shape at each turn: the assistant's own tool_calls, then one `tool`
 * message per call carrying that tool's result back.
 */
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export const modelRoutes = [
  "executive_reasoning",
  "executive_review",
  "worker_research",
  "worker_creative",
  "worker_writing",
  "worker_editing",
  "worker_structured",
  "worker_translation",
  "worker_fast",
  "multilingual_embedding",
  "multilingual_reranking",
  "premium_fallback"
] as const;
export type ModelRoute = typeof modelRoutes[number];

export type ModelRequestOptions = {
  maxCostMicros?: number;
  responseFormat?: { type: "json_object" };
  /** Omitted entirely from the request body when empty — byte-identical to a pre-tools call. */
  tools?: ToolDefinition[];
};

export async function requestLiteLLM(
  model: ModelRoute | string,
  messages: ChatMessage[],
  options: ModelRequestOptions = {}
) {
  if (isUiAuditMode()) throw new Error("Model calls are disabled in UI audit mode.");
  const baseUrl = process.env.LITELLM_BASE_URL;
  const apiKey = process.env.LITELLM_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("LiteLLM is not configured.");
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      ...(options.tools && options.tools.length > 0
        ? { tools: options.tools, tool_choice: "auto" }
        : {}),
      metadata: {
        route: model,
        max_cost_micros: options.maxCostMicros
      }
    })
  });

  if (!response.ok) {
    throw new Error(`LiteLLM request failed with status ${response.status}`);
  }
  return response.json();
}

/** Pulls the tool calls a model requested off a chat-completion response, if any. */
export function extractToolCalls(response: unknown): ToolCall[] {
  const message = (response as {
    choices?: Array<{ message?: { tool_calls?: ToolCall[] } }>;
  } | null | undefined)?.choices?.[0]?.message;
  return message?.tool_calls ?? [];
}

/** Reads final text from an OpenAI-compatible chat response. */
export function extractModelContent(response: unknown): string {
  const content = (response as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("The model returned no text.");
  return content;
}

export async function requestEmbedding(input: string): Promise<number[]> {
  const [embedding] = await requestEmbeddings([input]);
  if (!embedding) throw new Error("LiteLLM returned no embedding.");
  return embedding;
}

export async function requestEmbeddings(inputs: string[]): Promise<number[][]> {
  const baseUrl = process.env.LITELLM_BASE_URL;
  const apiKey = process.env.LITELLM_API_KEY;
  const model = process.env.LITELLM_EMBEDDING_ROUTE ?? "multilingual_embedding";
  if (!baseUrl || !apiKey) throw new Error("LiteLLM is not configured.");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, input: inputs })
  });
  if (!response.ok) {
    throw new Error(`LiteLLM embedding request failed with status ${response.status}`);
  }
  const payload = await response.json() as { data?: Array<{ index?: number; embedding?: number[] }> };
  const embeddings = (payload.data ?? [])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding)
    .filter((embedding): embedding is number[] => Array.isArray(embedding));
  if (embeddings.length !== inputs.length) throw new Error("LiteLLM returned incomplete embeddings.");
  return embeddings;
}

export async function requestReranking(query: string, documents: string[]) {
  const baseUrl = process.env.LITELLM_BASE_URL;
  const apiKey = process.env.LITELLM_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("LiteLLM is not configured.");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/rerank`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "multilingual_reranking",
      query,
      documents
    })
  });
  if (!response.ok) {
    throw new Error(`LiteLLM reranking request failed with status ${response.status}`);
  }
  return response.json();
}

export async function requestModel(
  model: ModelRoute,
  messages: ChatMessage[],
  telemetry?: {
    runId?: string;
    maxCostMicros?: number;
    structuredOutput?: boolean;
    tools?: ToolDefinition[];
    taskProfile?: ModelTaskProfile;
  }
) {
  const internalUrl = process.env.BUSINESS_OS_INTERNAL_URL;
  const callbackSecret = process.env.WORKFLOW_CALLBACK_SECRET;
  if (!internalUrl || !callbackSecret) {
    return requestLiteLLM(model, messages, {
      maxCostMicros: telemetry?.maxCostMicros,
      responseFormat: telemetry?.structuredOutput ? { type: "json_object" } : undefined,
      tools: telemetry?.tools
    });
  }

  const response = await fetch(`${internalUrl.replace(/\/$/, "")}/api/internal/model`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${callbackSecret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      runId: telemetry?.runId,
      maxCostMicros: telemetry?.maxCostMicros,
      structuredOutput: telemetry?.structuredOutput,
      tools: telemetry?.tools
      ,taskProfile: telemetry?.taskProfile
    })
  });
  if (!response.ok) {
    throw new Error(`Internal model request failed with status ${response.status}`);
  }
  return response.json();
}

export async function checkLiteLLM() {
  const baseUrl = process.env.LITELLM_BASE_URL;
  if (!baseUrl) return "not_configured";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health/liveliness`, {
    headers: process.env.LITELLM_API_KEY
      ? { Authorization: `Bearer ${process.env.LITELLM_API_KEY}` }
      : undefined,
    cache: "no-store"
  });
  if (!response.ok) throw new Error("LiteLLM is unavailable.");
  return "ok";
}
