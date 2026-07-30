import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createQuotaPolicy,
  listQuotaPolicies,
  updateQuotaPolicy
} from "@/lib/ai/usage";
import { guard } from "@/lib/api/guard";
import { parseJson } from "@/lib/http";

const createSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  route: z.string().trim().min(1).max(80).nullable().default(null),
  period: z.enum(["daily", "monthly"]),
  allowance: z.number().int().positive().max(100_000_000),
  timezone: z.string().trim().min(1).max(100)
});
const updateSchema = z.object({
  id: z.string().uuid(),
  allowance: z.number().int().positive().max(100_000_000).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  active: z.boolean().optional()
}).refine((value) => value.allowance !== undefined || value.timezone !== undefined || value.active !== undefined);

export const GET = guard(async () => {
  return NextResponse.json({ data: await listQuotaPolicies() });
}, { admin: true });

export const POST = guard(async (request, { session }) => {
  const parsed = await parseJson(request, createSchema);
  if (parsed.error) return parsed.error;
  const timezoneError = timezoneProblem(parsed.data.timezone);
  if (timezoneError) return timezoneError;
  return NextResponse.json({
    data: await createQuotaPolicy({
      ...parsed.data,
      route: parsed.data.route ?? null,
      actorId: session.userId
    })
  }, { status: 201 });
}, { admin: true });

export const PATCH = guard(async (request) => {
  const parsed = await parseJson(request, updateSchema);
  if (parsed.error) return parsed.error;
  if (parsed.data.timezone) {
    const timezoneError = timezoneProblem(parsed.data.timezone);
    if (timezoneError) return timezoneError;
  }
  const { id, ...changes } = parsed.data;
  return NextResponse.json({ data: await updateQuotaPolicy(id, changes) });
}, { admin: true });

/**
 * Returns a 400 rather than throwing. An unknown IANA zone is a bad input, and
 * letting the `Intl` constructor's RangeError propagate would surface it as an
 * unhandled 500 now that the guard reports unexpected throws that way.
 */
function timezoneProblem(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return null;
  } catch {
    return NextResponse.json(
      { error: "validation_error", detail: `"${timezone}" is not a known time zone.` },
      { status: 400 }
    );
  }
}
