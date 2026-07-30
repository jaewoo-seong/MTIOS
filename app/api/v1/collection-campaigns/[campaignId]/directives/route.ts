import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import {
  addCollectionDirective,
  directiveKinds,
  listCollectionDirectives
} from "@/lib/collection-research";
import { parseJson } from "@/lib/http";
import { logger } from "@/lib/observability/logger";

const schema = z.object({
  kind: z.enum(directiveKinds),
  instruction: z.string().trim().max(2000).default("")
});

export const GET = guard<{ campaignId: string }>(async (_request, { params }) => {
  return NextResponse.json({ data: await listCollectionDirectives(params.campaignId) });
});

/**
 * Writes a steering directive for a campaign that may be running right now.
 *
 * Returns as soon as the directive is recorded rather than waiting for it to
 * take effect, because taking effect happens on the loops' own schedule -
 * between discovery rounds, or before a dossier worker claims its next entity.
 * The response says so explicitly, since "accepted" and "applied" are different
 * facts and a person watching a long campaign needs to know which one they got.
 */
export const POST = guard<{ campaignId: string }>(async (request, { params, session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    const directive = await addCollectionDirective({
      campaignId: params.campaignId,
      kind: parsed.data.kind,
      instruction: parsed.data.instruction ?? "",
      createdBy: session.userId
    });
    logger.info("campaign.steered", {
      campaignId: params.campaignId,
      kind: parsed.data.kind,
      userId: session.userId
    });
    return NextResponse.json({
      data: {
        directive,
        appliesAt: parsed.data.kind === "add_criteria"
          ? "Before the next entity any worker starts, and to discovery from its next round."
          : "From the next discovery round. Work already completed is kept."
      }
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not record the directive."
    }, { status: 400 });
  }
});
