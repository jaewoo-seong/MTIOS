import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";
import { proposeResearchStrategy } from "@/lib/research-workspace";

const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  objective: z.string().trim().min(10).max(4000),
  context: z.string().trim().max(6000).default(""),
  scope: z.string().trim().max(3000).default(""),
  constraints: z.array(z.string().trim().min(1).max(500)).default([]),
  budgetCents: z.number().int().nonnegative().nullable().default(null),
  budgetCurrency: z.enum(["USD", "KRW"]).default("USD"),
  reviewGates: z.array(z.string().trim().min(1).max(160)).default([]),
  outputRequirements: z.array(z.string().trim().min(1).max(300)).default([]),
  outputLanguage: z.enum(["en", "ko", "bilingual"]).default("en"),
  permissions: z.object({
    externalSend: z.enum(["review_required", "blocked"]),
    clientDataWrite: z.enum(["review_required", "blocked"]),
    destructiveAction: z.enum(["review_required", "blocked"])
  }).default({
    externalSend: "review_required",
    clientDataWrite: "review_required",
    destructiveAction: "review_required"
  })
});

export const GET = guard(async () => {
  return NextResponse.json({ data: await repository.listProjects() });
});

export const POST = guard(async (request, { session }) => {
  const parsed = await parseJson(request, createProjectSchema);
  if (parsed.error) return parsed.error;
  const project = await repository.createProject({
      name: parsed.data.name,
      objective: parsed.data.objective,
      context: parsed.data.context ?? "",
      scope: parsed.data.scope ?? "",
      constraints: parsed.data.constraints ?? [],
      budgetCents: parsed.data.budgetCents ?? null,
      budgetCurrency: parsed.data.budgetCurrency,
      reviewGates: parsed.data.reviewGates ?? [],
      outputRequirements: parsed.data.outputRequirements ?? [],
      outputLanguage: parsed.data.outputLanguage,
      permissions: parsed.data.permissions
    }, session.userId);
  let strategyBootstrap: { status: "proposed" | "failed"; error?: string };
  try {
    await proposeResearchStrategy({
      projectId: project.id,
      userId: session.userId,
      instruction: "Create the first complete research strategy from this project brief. Extract the target market, geography, company profile, qualification rules, exclusions, evidence plan, dossier requirements, and a justified company target. Do not invent requirements that are absent; call out important gaps in your response."
    });
    strategyBootstrap = { status: "proposed" };
  } catch (error) {
    strategyBootstrap = { status: "failed", error: error instanceof Error ? error.message : "The initial strategy could not be generated." };
  }
  return NextResponse.json({ data: project, strategyBootstrap }, { status: 201 });
});
