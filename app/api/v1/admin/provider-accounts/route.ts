import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { guard } from "@/lib/api/guard";
import { requireDatabase } from "@/lib/db/client";
import { researchProviderAccounts } from "@/lib/db/schema";
import { parseJson } from "@/lib/http";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";
import { credentialedResearchProviderKeys, providerAccountLimits } from "@/lib/research/provider-keys";
import { isUiAuditMode } from "@/lib/ui-audit-mode";

const createSchema = z.object({
  provider: z.enum(credentialedResearchProviderKeys),
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
  if (isUiAuditMode()) return NextResponse.json({ data: auditProviderAccounts() });
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

function auditProviderAccounts() {
  const base = { ownerLabel: "Personal account", allowance: 1000, status: "active", resetAt: null, cooldownUntil: null, credentialConfigured: true, authorizationConfirmed: true, lastError: null };
  return [
    ["10000000-0000-4000-8000-000000000101", "tavily", "Tavily personal 1", "TAVILY_API_KEY", 1],
    ["10000000-0000-4000-8000-000000000102", "tavily", "Tavily personal 2", "TAVILY_API_KEY_BACKUP", 2],
    ["10000000-0000-4000-8000-000000000103", "tavily", "Tavily personal 3", "TAVILY_API_KEY_3", 3],
    ["10000000-0000-4000-8000-000000000104", "firecrawl", "Firecrawl personal 1", "FIRECRAWL_API_KEY", 1],
    ["10000000-0000-4000-8000-000000000105", "firecrawl", "Firecrawl personal 2", "FIRECRAWL_API_KEY_2", 2],
    ["10000000-0000-4000-8000-000000000106", "firecrawl", "Firecrawl personal 3", "FIRECRAWL_API_KEY_3", 3]
  ].map(([id, provider, label, credentialEnv, priority]) => ({ ...base, id, provider, label, credentialEnv, priority }));
}

export const POST = guard(async (request) => {
  const parsed = await parseJson(request, createSchema);
  if (parsed.error) return parsed.error;
  const db = requireDatabase();
  const existing = await db.select({ id: researchProviderAccounts.id }).from(researchProviderAccounts).where(and(
    eq(researchProviderAccounts.organizationId, MTI_ORGANIZATION_ID),
    eq(researchProviderAccounts.provider, parsed.data.provider)
  ));
  if (existing.length >= providerAccountLimits[parsed.data.provider]) {
    return NextResponse.json({ error: `${parsed.data.provider} supports ${providerAccountLimits[parsed.data.provider]} account slot(s).` }, { status: 409 });
  }
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
