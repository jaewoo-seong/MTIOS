import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { createResearchCampaign } from "@/lib/company-research";
import { repository } from "@/lib/repository";

const campaignSchema = z.object({
  projectId: z.string().uuid(),
  agendaId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(200),
  targetCount: z.number().int().min(1).max(100000),
  scope: z.record(z.string(), z.unknown()).default({}),
  qualificationRules: z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
  requiredFields: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  exclusions: z.array(z.string().trim().min(1).max(500)).max(1000).default([]),
  sourcePlan: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  queryPlan: z.array(z.string().trim().min(1).max(1000)).max(500).default([]),
  existingCountPolicy: z.enum(["ask", "include", "exclude"]).default("ask")
});

export async function POST(request: Request) {
  const parsed = await parseJson(request, campaignSchema);
  if (parsed.error) return parsed.error;
  if (!await repository.getProject(parsed.data.projectId)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const campaign = await createResearchCampaign(parsed.data);
  return NextResponse.json({ data: campaign }, { status: 201 });
}
