import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";
import { getWorkspacePreferences, updateWorkspacePreferences } from "@/lib/settings";

const schema = z.object({
  locale: z.enum(["en", "ko"]),
  timezone: z.string().min(1).max(100),
  dateFormat: z.enum(["short", "medium", "long"]),
  numberFormat: z.literal("locale"),
  currency: z.enum(["USD", "KRW"])
});

export const GET = guard(async (_request, { session }) => {
  return NextResponse.json({ data: await getWorkspacePreferences(session.userId) });
});

export const PATCH = guard(async (request, { session }) => {
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  return NextResponse.json({ data: await updateWorkspacePreferences(parsed.data, session.userId) });
});
