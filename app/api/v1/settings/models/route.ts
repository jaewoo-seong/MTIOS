import { NextResponse } from "next/server";
import { modelRoutePolicies } from "@/lib/ai/model-policy";
import { checkLiteLLM } from "@/lib/ai/litellm";
import { db } from "@/lib/db/client";
import { modelCalls } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { listModelRouteRevisions } from "@/lib/settings";

export async function GET() {
  const environment = process.env.NODE_ENV === "production" ? "production" : "development";
  const [health, recentCalls, revisions] = await Promise.all([
    checkLiteLLM().catch(() => "unavailable"),
    db ? db.select().from(modelCalls).orderBy(desc(modelCalls.createdAt)).limit(50) : [],
    listModelRouteRevisions()
  ]);
  return NextResponse.json({
    environment,
    gateway: "LiteLLM",
    health,
    recentCalls,
    revisions,
    routes: Object.entries(modelRoutePolicies).map(([route, policy]) => ({
      route,
      purpose: policy.purpose,
      maxCostMicros: policy.maxCostMicros,
      structuredOutput: policy.structuredOutput,
      candidates: policy.candidates.map((candidate, index) => ({
        order: index + 1,
        provider: candidate.provider,
        modelEnv: candidate.modelEnv,
        model: process.env[candidate.modelEnv] ?? "not_configured",
        pricingClass: candidate.pricingClass,
        productionApproved: candidate.productionApproved,
        licensingStatus: candidate.licensingStatus,
        enabled: environment !== "production" || candidate.productionApproved ||
          (candidate.provider === "nvidia" && process.env.NVIDIA_PRODUCTION_APPROVED === "true")
      }))
    }))
  });
}
