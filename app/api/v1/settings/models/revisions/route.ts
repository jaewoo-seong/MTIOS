import { NextResponse } from "next/server";
import { z } from "zod";
import { modelRoutes } from "@/lib/ai/litellm";
import { gatewayModelCatalog, modelRoutePolicies, resolveGatewayModel } from "@/lib/ai/model-policy";
import { parseJson } from "@/lib/http";
import { createModelRouteRevision, listModelRouteRevisions } from "@/lib/settings";
import { guard } from "@/lib/api/guard";

const routeSchema = z.enum(modelRoutes);
const candidateSchema = z.object({
  provider: z.enum(["openrouter", "nvidia"]),
  modelEnv: z.string().min(1),
  gatewayModel: z.string().min(1).max(100),
  pricingClass: z.enum(["paid", "free"]),
  productionApproved: z.boolean(),
  licensingStatus: z.enum(["approved", "testing_only", "unverified"])
  ,strengths: z.array(z.enum(["research", "writing", "editing", "extraction", "translation", "classification", "planning", "review", "creative"])).max(9).optional()
  ,languages: z.array(z.enum(["en", "ko"])).max(2).optional()
  ,supportsStructuredOutput: z.boolean().optional()
  ,supportsTools: z.boolean().optional()
  ,longContext: z.boolean().optional()
});
const schema = z.object({
  route: routeSchema,
  maxCostMicros: z.number().int().positive().max(1_000_000),
  structuredOutput: z.boolean(),
  candidates: z.array(candidateSchema).min(1).max(5)
});

export const GET = guard(async (request) => {
  const route = new URL(request.url).searchParams.get("route");
  const parsedRoute = route ? routeSchema.safeParse(route) : null;
  if (route && !parsedRoute?.success) {
    return NextResponse.json({ error: "Invalid model route." }, { status: 400 });
  }
  return NextResponse.json({ data: await listModelRouteRevisions(parsedRoute?.data) });
}, { admin: true });

export const POST = guard(async (request) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const base = modelRoutePolicies[parsed.data.route];
  const invalidModel = parsed.data.candidates.some((candidate) =>
    candidate.provider === "openrouter" &&
    !gatewayModelCatalog.some((item) => item.gatewayModel === resolveGatewayModel(candidate.gatewayModel)) &&
    !parsed.data.route.startsWith("executive") && parsed.data.route !== "premium_fallback"
  );
  if (invalidModel) return NextResponse.json({ error: "Model is not in the approved catalog." }, { status: 400 });
  const unsafePromotion = parsed.data.candidates.some((candidate) => {
    const current = base.candidates.find((item) =>
      item.provider === candidate.provider && resolveGatewayModel(item.gatewayModel) === resolveGatewayModel(candidate.gatewayModel)
    );
    return candidate.productionApproved && !current?.productionApproved &&
      !(candidate.provider === "nvidia" && process.env.NVIDIA_PRODUCTION_APPROVED === "true");
  });
  if (unsafePromotion) {
    return NextResponse.json({
      error: "Provider production approval requires the server-side licensing gate."
    }, { status: 409 });
  }
  return NextResponse.json({
    data: await createModelRouteRevision(parsed.data.route, {
      purpose: base.purpose,
      maxCostMicros: parsed.data.maxCostMicros,
      structuredOutput: parsed.data.structuredOutput,
      candidates: parsed.data.candidates
    })
  }, { status: 201 });
}, { admin: true });
