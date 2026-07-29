import { NextResponse } from "next/server";
import { z } from "zod";
import { addMarketingVariant } from "@/lib/creative-work";
import { parseJson } from "@/lib/http";

const schema = z.object({
  name: z.string().trim().min(1).max(300),
  channel: z.string().trim().min(1).max(100),
  format: z.string().trim().min(1).max(100),
  content: z.string().max(100000).default("")
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conceptId: string }> }
) {
  const { conceptId } = await params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({
    data: await addMarketingVariant(conceptId, parsed.data)
  }, { status: 201 });
}
