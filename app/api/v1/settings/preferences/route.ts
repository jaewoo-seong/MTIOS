import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { getWorkspacePreferences, updateWorkspacePreferences } from "@/lib/settings";

const schema = z.object({
  locale: z.enum(["en", "ko"]),
  timezone: z.string().min(1).max(100),
  dateFormat: z.enum(["short", "medium", "long"]),
  numberFormat: z.literal("locale"),
  currency: z.enum(["USD", "KRW"])
});

export async function GET() {
  return NextResponse.json({ data: await getWorkspacePreferences() });
}

export async function PATCH(request: Request) {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({ data: await updateWorkspacePreferences(parsed.data) });
}
