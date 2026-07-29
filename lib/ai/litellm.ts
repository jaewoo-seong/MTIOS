type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type ModelRoute = "executive_reasoning" | "executive_review" | "worker_research" | "worker_structured" | "worker_fast";

export async function requestLiteLLM(
  model: ModelRoute,
  messages: ChatMessage[]
) {
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
    body: JSON.stringify({ model, messages, temperature: 0.2 })
  });

  if (!response.ok) {
    throw new Error(`LiteLLM request failed with status ${response.status}`);
  }
  return response.json();
}

export async function requestModel(model: ModelRoute, messages: ChatMessage[]) {
  const internalUrl = process.env.BUSINESS_OS_INTERNAL_URL;
  const callbackSecret = process.env.WORKFLOW_CALLBACK_SECRET;
  if (!internalUrl || !callbackSecret) {
    return requestLiteLLM(model, messages);
  }

  const response = await fetch(`${internalUrl.replace(/\/$/, "")}/api/internal/model`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${callbackSecret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, messages })
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
