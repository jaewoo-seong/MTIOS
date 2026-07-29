import { NextResponse } from "next/server";
import { z } from "zod";
import { modelRoutes } from "@/lib/ai/litellm";
import { modelRoutePolicies } from "@/lib/ai/model-policy";
import { parseJson } from "@/lib/http";
import { createModelRouteRevision, listModelRouteRevisions } from "@/lib/settings";
import { currentSession } from "@/lib/auth";

const routeSchema = z.enum(modelRoutes);
const candidateSchema = z.object({
  provider: z.enum(["openrouter", "nvidia"]),
  modelEnv: z.string().min(1),
  pricingClass: z.enum(["paid", "free"]),
  productionApproved: z.boolean(),
  licensingStatus: z.enum(["approved", "testing_only", "unverified"])
});
const schema = z.object({
  route: routeSchema,
  maxCostMicros: z.number().int().positive().max(1_000_000),
  structuredOutput: z.boolean(),
  candidates: z.array(candidateSchema).min(1).max(5)
});

export async function GET(request: Request) {
  await currentSession({ admin: true });
  const route = new URL(request.url).searchParams.get("route");
  const parsedRoute = route ? routeSchema.safeParse(route) : null;
  if (route && !parsedRoute?.success) {
    return NextResponse.json({ error: "Invalid model route." }, { status: 400 });
  }
  return NextResponse.json({ data: await listModelRouteRevisions(parsedRoute?.data) });
}

export async function POST(request: Request) {
  await currentSession({ admin: true });
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const base = modelRoutePolicies[parsed.data.route];
  const unsafePromotion = parsed.data.candidates.some((candidate) => {
    const current = base.candidates.find((item) =>
      item.provider === candidate.provider && item.modelEnv === candidate.modelEnv
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
}
