import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

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

export async function GET() {
  return NextResponse.json({ data: await repository.listProjects() });
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, createProjectSchema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await repository.createProject({
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
    })
  }, { status: 201 });
}
