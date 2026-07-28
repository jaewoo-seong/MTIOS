type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function requestModel(
  model: "executive_reasoning" | "executive_review" | "worker_research" | "worker_structured" | "worker_fast",
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
