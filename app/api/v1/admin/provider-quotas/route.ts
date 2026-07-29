import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, currentSession } from "@/lib/auth";
import {
  createQuotaPolicy,
  listQuotaPolicies,
  updateQuotaPolicy
} from "@/lib/ai/usage";
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

export async function GET() {
  try {
    await currentSession({ admin: true });
    return NextResponse.json({ data: await listQuotaPolicies() });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const parsed = await parseJson(request, createSchema);
  if (parsed.error) return parsed.error;
  try {
    assertTimezone(parsed.data.timezone);
    const actor = await currentSession({ admin: true });
    return NextResponse.json({
      data: await createQuotaPolicy({
        ...parsed.data,
        route: parsed.data.route ?? null,
        actorId: actor.userId
      })
    }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  const parsed = await parseJson(request, updateSchema);
  if (parsed.error) return parsed.error;
  try {
    await currentSession({ admin: true });
    if (parsed.data.timezone) assertTimezone(parsed.data.timezone);
    const { id, ...changes } = parsed.data;
    return NextResponse.json({ data: await updateQuotaPolicy(id, changes) });
  } catch (error) {
    return failure(error);
  }
}

function assertTimezone(timezone: string) {
  new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
}

function failure(error: unknown) {
  return NextResponse.json({
    error: error instanceof Error ? error.message : "Request failed."
  }, { status: error instanceof AuthError ? error.status : 400 });
}
