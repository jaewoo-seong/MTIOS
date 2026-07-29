import { NextResponse } from "next/server";
import { modelRoutePolicies } from "@/lib/ai/model-policy";

export async function GET() {
  const environment = process.env.NODE_ENV === "production" ? "production" : "development";
  return NextResponse.json({
    environment,
    gateway: "LiteLLM",
    routes: Object.entries(modelRoutePolicies).map(([route, policy]) => ({
      route,
      purpose: policy.purpose,
      maxCostMicros: policy.maxCostMicros,
      structuredOutput: policy.structuredOutput,
      candidates: policy.candidates.map((candidate, index) => ({
        order: index + 1,
        provider: candidate.provider,
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
