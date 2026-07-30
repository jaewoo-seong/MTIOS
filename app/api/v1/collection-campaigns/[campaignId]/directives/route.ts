import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@/lib/auth";
import {
  addCollectionDirective,
  directiveKinds,
  listCollectionDirectives
} from "@/lib/collection-research";
import { parseJson } from "@/lib/http";

const schema = z.object({
  kind: z.enum(directiveKinds),
  instruction: z.string().trim().max(2000).default("")
});

export async function GET(
  _: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  await currentSession();
  const { campaignId } = await params;
  return NextResponse.json({ data: await listCollectionDirectives(campaignId) });
}

/**
 * Writes a steering directive for a campaign that may be running right now.
 *
 * This returns as soon as the directive is recorded rather than waiting for it
 * to take effect, because taking effect happens on the loops' own schedule -
 * between discovery rounds, or before a dossier worker claims its next entity.
 * The response says so explicitly, since "accepted" and "applied" are
 * different facts and a person watching a long campaign needs to know which
 * one they just got.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const actor = await currentSession();
  const { campaignId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    const directive = await addCollectionDirective({
      campaignId,
      kind: parsed.data.kind,
      instruction: parsed.data.instruction ?? "",
      createdBy: actor.userId
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
}
