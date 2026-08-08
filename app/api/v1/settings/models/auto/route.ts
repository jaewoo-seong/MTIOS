import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { inferTaskProfile, modelRoutePolicies, rankModelCandidates, resolveGatewayModel } from "@/lib/ai/model-policy";
import { requestLiteLLM, type ModelRoute } from "@/lib/ai/litellm";
import { activateModelPoliciesAtomically, getActiveModelPolicy } from "@/lib/settings";

const workerRoutes = (Object.keys(modelRoutePolicies) as ModelRoute[]).filter((route) => route.startsWith("worker_"));

/** Applies the recommended free model to every worker through the normal tested revision path. */
export const POST = guard(async () => {
  const tested: string[] = [];
  const policies: Array<{ route: ModelRoute; configuration: typeof modelRoutePolicies[ModelRoute] }> = [];
  for (const route of workerRoutes) {
    const recommended = modelRoutePolicies[route];
    const active = await getActiveModelPolicy(route);
    const configuration = {
      ...recommended,
      maxCostMicros: active.maxCostMicros,
      structuredOutput: active.structuredOutput
    };
    const eligible = rankModelCandidates(configuration, inferTaskProfile(route, [], {
      structuredOutput: active.structuredOutput
    })).map((item) => item.candidate);
    if (eligible.length === 0) {
      return NextResponse.json({ error: `No candidate satisfies the automatic policy for ${route}. No routes were changed.` }, { status: 422 });
    }
    configuration.candidates = eligible;
    for (const candidate of eligible) {
      try {
        const response = await requestLiteLLM(resolveGatewayModel(candidate.gatewayModel), [
          { role: "user", content: active.structuredOutput ? "Return JSON with {\"status\":\"ok\"}." : "Reply with OK." }
        ], {
          maxCostMicros: active.maxCostMicros,
          responseFormat: active.structuredOutput ? { type: "json_object" } : undefined
        }) as { choices?: Array<{ message?: { content?: string } }> };
        if (active.structuredOutput) JSON.parse(response.choices?.[0]?.message?.content ?? "");
        tested.push(`${route}:${resolveGatewayModel(candidate.gatewayModel)}`);
      } catch (error) {
        return NextResponse.json({
          error: `Automatic routing validation failed for ${route}/${resolveGatewayModel(candidate.gatewayModel)}. No routes were changed.`,
          detail: error instanceof Error ? error.message : "Test failed.", tested
        }, { status: 422 });
      }
    }
    policies.push({ route, configuration });
  }
  const revisions = await activateModelPoliciesAtomically(policies);
  return NextResponse.json({ data: { applied: workerRoutes, tested, revisionIds: revisions.map((item) => item.id) } });
}, { admin: true, rateLimit: "expensive" });
