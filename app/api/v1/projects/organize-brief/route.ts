import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { extractModelContent, requestModel } from "@/lib/ai/litellm";

const inputSchema = z.object({ brief: z.string().trim().min(10).max(20000) });
const organizedSchema = z.object({
  name: z.string().max(120).default(""), objective: z.string().max(4000).default(""),
  context: z.string().max(6000).default(""), scope: z.string().max(3000).default(""),
  constraints: z.array(z.string().max(500)).default([]), budget: z.string().max(40).default(""),
  reviewGates: z.array(z.string().max(160)).default([]),
  outputRequirements: z.array(z.string().max(300)).default([]),
  outputLanguage: z.enum(["en", "ko", "bilingual", ""]).default("")
});

export const POST = guard(async (request) => {
  const parsed = await parseJson(request, inputSchema);
  if (parsed.error) return parsed.error;
  const response = await requestModel("executive_reasoning", [
    { role: "system", content: "Organize a client-research project brief into the supplied JSON fields. Preserve facts and wording. Do not invent missing information: use an empty string or empty array. budget is the numeric amount only. outputLanguage is en, ko, bilingual, or empty. Return JSON only." },
    { role: "user", content: parsed.data.brief }
  ], { structuredOutput: true, maxCostMicros: 120_000 });
  const content = extractModelContent(response).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const organized = organizedSchema.parse(JSON.parse(content));
  return NextResponse.json({ data: organized });
}, { rateLimit: "expensive" });
