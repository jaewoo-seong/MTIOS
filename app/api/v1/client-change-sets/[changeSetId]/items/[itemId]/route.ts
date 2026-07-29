import { NextResponse } from "next/server";
import { z } from "zod";
import { reviseClientChangeItem } from "@/lib/client-changes";
import { parseJson } from "@/lib/http";

const schema = z.object({
  after: z.record(z.string(), z.string()).nullable(),
  note: z.string().max(5000).default("")
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ changeSetId: string; itemId: string }> }
) {
  const { changeSetId, itemId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    const changeSet = await reviseClientChangeItem({
      changeSetId, itemId, after: parsed.data.after, note: parsed.data.note
    });
    return changeSet
      ? NextResponse.json({ data: changeSet })
      : NextResponse.json({ error: "Change set not found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Change item could not be revised."
    }, { status: 409 });
  }
}
