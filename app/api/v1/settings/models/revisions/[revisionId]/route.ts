import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { requestEmbedding, requestLiteLLM, requestReranking } from "@/lib/ai/litellm";
import { listModelRouteRevisions, setModelRevisionState } from "@/lib/settings";
import { guard } from "@/lib/api/guard";

const schema = z.object({
  action: z.enum(["test", "approve", "activate", "rollback"])
});

/**
 * `expensive`: the `test` action makes a real model call against the route being
 * revised, so this endpoint spends money per request.
 */
export const POST = guard<{ revisionId: string }>(async (request, { params }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const { revisionId } = params;
  try {
    if (parsed.data.action === "test") {
      const revision = (await listModelRouteRevisions()).find((item) => item.id === revisionId);
      if (!revision) throw new Error("Model route revision not found.");
      try {
        if (revision.route === "multilingual_embedding") {
          const embedding = await requestEmbedding("MTI 모델 테스트");
          if (embedding.length === 0) throw new Error("Embedding route returned no vector.");
        } else if (revision.route === "multilingual_reranking") {
          await requestReranking("MTI", ["MTI Korea", "Unrelated"]);
        } else {
          const response = await requestLiteLLM(revision.route as Parameters<typeof requestLiteLLM>[0], [
            { role: "user", content: "Return JSON with {\"status\":\"ok\"}." }
          ], {
            maxCostMicros: revision.configuration.maxCostMicros,
            responseFormat: revision.configuration.structuredOutput ? { type: "json_object" } : undefined
          }) as { choices?: Array<{ message?: { content?: string } }> };
          if (revision.configuration.structuredOutput) {
            JSON.parse(response.choices?.[0]?.message?.content ?? "");
          }
        }
        return NextResponse.json({
          data: await setModelRevisionState(revisionId, "test_passed")
        });
      } catch (error) {
        return NextResponse.json({
          data: await setModelRevisionState(
            revisionId,
            "test_failed",
            error instanceof Error ? error.message : "Test failed."
          )
        }, { status: 422 });
      }
    }
    return NextResponse.json({
      data: await setModelRevisionState(revisionId, parsed.data.action)
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Model route update failed."
    }, { status: 409 });
  }
}, { admin: true, rateLimit: "expensive" });
