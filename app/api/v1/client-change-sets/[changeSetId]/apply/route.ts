import { NextResponse } from "next/server";
import { z } from "zod";
import { applyClientChangeSet } from "@/lib/client-changes";
import { parseJson } from "@/lib/http";

const schema = z.object({ approvalToken: z.string().min(20).max(500) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ changeSetId: string }> }
) {
  const { changeSetId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    const application = await applyClientChangeSet(changeSetId, parsed.data.approvalToken);
    return NextResponse.json({ data: application }, {
      status: application.status === "conflict" ? 409 : 200
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Change set could not be applied."
    }, { status: 409 });
  }
}
