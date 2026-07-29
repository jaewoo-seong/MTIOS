import { NextResponse } from "next/server";
import { z } from "zod";
import { requestLiteLLM } from "@/lib/ai/litellm";
import { parseJson } from "@/lib/http";
import { isValidWorkflowRequest } from "@/lib/internal-auth";

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
  })).min(1).max(100)
});

export async function POST(request: Request) {
  if (!isValidWorkflowRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json(await requestLiteLLM(parsed.data.model, parsed.data.messages));
}
