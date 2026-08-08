import { NextResponse } from "next/server";
import { gatewayModelCatalog, modelRoutePolicies, resolveGatewayModel, type ModelCandidate } from "@/lib/ai/model-policy";
import { checkLiteLLM } from "@/lib/ai/litellm";
import { db } from "@/lib/db/client";
import { modelCalls } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { getActiveModelPolicy, listModelRouteRevisions } from "@/lib/settings";
import { guard } from "@/lib/api/guard";

export const GET = guard(async () => {
  const environment = process.env.NODE_ENV === "production" ? "production" : "development";
  const testingMode = process.env.ALLOW_TESTING_MODELS === "true";
  const routeEntries = Object.entries(modelRoutePolicies);
  const [health, recentCalls, revisions, activePolicies] = await Promise.all([
    checkLiteLLM().catch(() => "unavailable"),
    db ? db.select().from(modelCalls).orderBy(desc(modelCalls.createdAt)).limit(50) : [],
    listModelRouteRevisions(),
    Promise.all(routeEntries.map(([route]) => getActiveModelPolicy(route as keyof typeof modelRoutePolicies)))
  ]);
  return NextResponse.json({
    environment,
    testingMode,
    gateway: "LiteLLM",
    health,
    recentCalls,
    revisions,
    catalog: gatewayModelCatalog,
    routes: routeEntries.map(([route], routeIndex) => {
      const policy = activePolicies[routeIndex];
      return ({
      route,
      purpose: policy.purpose,
      maxCostMicros: policy.maxCostMicros,
      structuredOutput: policy.structuredOutput,
      recommendedGatewayModel: resolveGatewayModel(modelRoutePolicies[route as keyof typeof modelRoutePolicies].candidates[0]?.gatewayModel ?? route),
      candidates: policy.candidates.map((rawCandidate, index) => {
        const candidate = rawCandidate as ModelCandidate;
        return ({
        order: index + 1,
        provider: candidate.provider,
        modelEnv: candidate.modelEnv,
        gatewayModel: candidate.gatewayModel,
        selectionMode: candidate.gatewayModel.startsWith("auto:") ? "auto" : "manual",
        model: gatewayModelCatalog.find((item) => item.gatewayModel === resolveGatewayModel(candidate.gatewayModel))?.model ?? process.env[candidate.modelEnv] ?? "not_configured",
        pricingClass: candidate.pricingClass,
        productionApproved: candidate.productionApproved,
        licensingStatus: candidate.licensingStatus,
        strengths: candidate.strengths ?? [],
        languages: candidate.languages ?? [],
        supportsStructuredOutput: candidate.supportsStructuredOutput ?? false,
        supportsTools: candidate.supportsTools ?? false,
        longContext: candidate.longContext ?? false,
        enabled: environment !== "production" || candidate.productionApproved ||
          (testingMode && candidate.licensingStatus === "testing_only") ||
          (candidate.provider === "nvidia" && process.env.NVIDIA_PRODUCTION_APPROVED === "true")
        });
      })
      });
    })
  });
}, { admin: true });
