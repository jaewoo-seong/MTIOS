import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { requireDatabase } from "@/lib/db/client";
import { researchProviderAccounts } from "@/lib/db/schema";
import { parseJson } from "@/lib/http";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";

const createSchema = z.object({
  provider: z.enum(["tavily", "firecrawl"]),
  label: z.string().trim().min(1).max(120),
  ownerLabel: z.string().trim().max(120).default(""),
  credentialEnv: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,99}$/),
  priority: z.number().int().min(1).max(1000).default(100),
  allowance: z.number().int().positive().max(100_000_000).nullable().default(1000),
  quotaPeriod: z.enum(["daily", "monthly"]).default("monthly"),
  authorizationConfirmed: z.boolean().default(false)
});

const updateSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(120).optional(),
  priority: z.number().int().min(1).max(1000).optional(),
  allowance: z.number().int().positive().max(100_000_000).nullable().optional(),
  resetAt: z.string().datetime().nullable().optional(),
  status: z.enum(["active", "disabled"]).optional(),
  authorizationConfirmed: z.boolean().optional()
});

export const GET = guard(async () => {
  const db = requireDatabase();
  const rows = await db.select().from(researchProviderAccounts).where(
    eq(researchProviderAccounts.organizationId, MTI_ORGANIZATION_ID)
  ).orderBy(asc(researchProviderAccounts.provider), asc(researchProviderAccounts.priority));
  return NextResponse.json({ data: rows.map((row) => ({
    ...row,
    credentialConfigured: Boolean(process.env[row.credentialEnv]),
    authorizationConfirmed: Boolean(row.authorizationConfirmedAt)
  })) });
}, { admin: true });

export const POST = guard(async (request) => {
  const parsed = await parseJson(request, createSchema);
  if (parsed.error) return parsed.error;
  const db = requireDatabase();
  const [row] = await db.insert(researchProviderAccounts).values({
    organizationId: MTI_ORGANIZATION_ID,
    provider: parsed.data.provider,
    label: parsed.data.label,
    ownerLabel: parsed.data.ownerLabel,
    credentialEnv: parsed.data.credentialEnv,
    priority: parsed.data.priority,
    allowance: parsed.data.allowance,
    quotaPeriod: parsed.data.quotaPeriod,
    authorizationConfirmedAt: parsed.data.authorizationConfirmed ? new Date() : null
  }).returning();
  return NextResponse.json({ data: row }, { status: 201 });
}, { admin: true });

export const PATCH = guard(async (request) => {
  const parsed = await parseJson(request, updateSchema);
  if (parsed.error) return parsed.error;
  const { id, authorizationConfirmed, resetAt, ...values } = parsed.data;
  const db = requireDatabase();
  const [row] = await db.update(researchProviderAccounts).set({
    ...values,
    ...(authorizationConfirmed !== undefined
      ? { authorizationConfirmedAt: authorizationConfirmed ? new Date() : null }
      : {}),
    ...(resetAt !== undefined ? { resetAt: resetAt ? new Date(resetAt) : null } : {}),
    updatedAt: new Date()
  }).where(and(
    eq(researchProviderAccounts.id, id),
    eq(researchProviderAccounts.organizationId, MTI_ORGANIZATION_ID)
  )).returning();
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data: row });
}, { admin: true });
