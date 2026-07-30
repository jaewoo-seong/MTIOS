import { NextResponse } from "next/server";
import { z } from "zod";
import { addContentCalendarItem } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

import { guard } from "@/lib/api/guard";
const schema = z.object({
  variantId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(300),
  channel: z.string().trim().min(1).max(100),
  scheduledFor: z.string().datetime().nullable().optional()
});

export const POST = guard<{ campaignId: string }>(async (request, { params }) => {
  const { campaignId } = params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  try {
    const item = await addContentCalendarItem(campaignId, {
      ...parsed.data,
      scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null
    });
    return NextResponse.json({ data: item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Calendar item could not be created."
    }, { status: 404 });
  }
});
