import { NextResponse } from "next/server";
import { modelRoutePolicies } from "@/lib/ai/model-policy";
import { checkLiteLLM } from "@/lib/ai/litellm";
import { db } from "@/lib/db/client";
import { modelCalls } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { listModelRouteRevisions } from "@/lib/settings";
import { currentSession } from "@/lib/auth";

export async function GET() {
  await currentSession({ admin: true });
  const environment = process.env.NODE_ENV === "production" ? "production" : "development";
  const testingMode = process.env.ALLOW_TESTING_MODELS === "true";
  const [health, recentCalls, revisions] = await Promise.all([
    checkLiteLLM().catch(() => "unavailable"),
    db ? db.select().from(modelCalls).orderBy(desc(modelCalls.createdAt)).limit(50) : [],
    listModelRouteRevisions()
  ]);
  return NextResponse.json({
    environment,
    testingMode,
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
          (testingMode && candidate.licensingStatus === "testing_only") ||
          (candidate.provider === "nvidia" && process.env.NVIDIA_PRODUCTION_APPROVED === "true")
      }))
    }))
  });
}
