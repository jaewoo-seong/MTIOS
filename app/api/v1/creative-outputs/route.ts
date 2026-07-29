import { NextResponse } from "next/server";
import { z } from "zod";
import { createCreativeOutput } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

const schema = z.object({
  projectId: z.string().uuid(),
  agendaId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(180),
  outputType: z.enum([
    "brief",
    "campaign_plan",
    "calendar",
    "copy",
    "creative_concept",
    "decision_memo",
    "experiment_plan"
  ]),
  summary: z.string().max(4000).default(""),
  content: z.string().max(100000).default("")
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await createCreativeOutput(parsed.data)
  }, { status: 201 });
}
