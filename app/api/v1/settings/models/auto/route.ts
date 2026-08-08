import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { modelRoutePolicies, resolveGatewayModel } from "@/lib/ai/model-policy";
import { requestLiteLLM, type ModelRoute } from "@/lib/ai/litellm";
import { createModelRouteRevision, getActiveModelPolicy, setModelRevisionState } from "@/lib/settings";

const workerRoutes = (Object.keys(modelRoutePolicies) as ModelRoute[]).filter((route) => route.startsWith("worker_"));

/** Applies the recommended free model to every worker through the normal tested revision path. */
export const POST = guard(async () => {
  const applied: string[] = [];
  for (const route of workerRoutes) {
    const recommended = modelRoutePolicies[route];
    const active = await getActiveModelPolicy(route);
    const revision = await createModelRouteRevision(route, {
      ...recommended,
      maxCostMicros: active.maxCostMicros,
      structuredOutput: active.structuredOutput
    });
    try {
      const response = await requestLiteLLM(resolveGatewayModel(recommended.candidates[0].gatewayModel), [
        { role: "user", content: "Return JSON with {\"status\":\"ok\"}." }
      ], {
        maxCostMicros: active.maxCostMicros,
        responseFormat: active.structuredOutput ? { type: "json_object" } : undefined
      }) as { choices?: Array<{ message?: { content?: string } }> };
      if (active.structuredOutput) JSON.parse(response.choices?.[0]?.message?.content ?? "");
      await setModelRevisionState(revision.id, "test_passed");
      await setModelRevisionState(revision.id, "approve");
      await setModelRevisionState(revision.id, "activate");
      applied.push(route);
    } catch (error) {
      await setModelRevisionState(revision.id, "test_failed", error instanceof Error ? error.message : "Test failed.");
      return NextResponse.json({ error: `Automatic routing stopped at ${route}.`, applied }, { status: 422 });
    }
  }
  return NextResponse.json({ data: { applied } });
}, { admin: true, rateLimit: "expensive" });
