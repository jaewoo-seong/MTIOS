import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { researchProviderAccounts, researchProviderAccountUsage } from "@/lib/db/schema";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";

export type ProviderAccountRef = {
  id: string | null;
  provider: string;
  label: string;
  credentialEnv: string;
  allowance: number | null;
  used: number;
  resetAt: Date | null;
};

export async function availableProviderAccounts(provider: string, legacyCredentialEnvs: string[]) {
  const now = new Date();
  if (db) {
    const rows = await db.select().from(researchProviderAccounts).where(and(
      eq(researchProviderAccounts.organizationId, MTI_ORGANIZATION_ID),
      eq(researchProviderAccounts.provider, provider),
      eq(researchProviderAccounts.status, "active")
    )).orderBy(asc(researchProviderAccounts.priority));
    const configured = rows.filter((row) =>
      Boolean(process.env[row.credentialEnv]) &&
      Boolean(row.authorizationConfirmedAt) &&
      (!row.cooldownUntil || row.cooldownUntil <= now)
    );
    if (rows.length > 0) {
      const accounts: ProviderAccountRef[] = [];
      for (const row of configured) {
        const start = periodStart(row.quotaPeriod, row.resetAt, now);
        const [{ used }] = await db.select({
          used: sql<number>`coalesce(sum(${researchProviderAccountUsage.quantity}), 0)::int`
        }).from(researchProviderAccountUsage).where(and(
          eq(researchProviderAccountUsage.accountId, row.id),
          gte(researchProviderAccountUsage.occurredAt, start)
        ));
        if (row.allowance !== null && used >= row.allowance) continue;
        accounts.push({
          id: row.id, provider, label: row.label, credentialEnv: row.credentialEnv,
          allowance: row.allowance, used, resetAt: row.resetAt
        });
      }
      return accounts;
    }
  }
  return legacyCredentialEnvs.filter((credentialEnv) => Boolean(process.env[credentialEnv])).map(
    (credentialEnv, index): ProviderAccountRef => ({
      id: null, provider, label: `Legacy account ${index + 1}`, credentialEnv,
      allowance: null, used: 0, resetAt: null
    })
  );
}

export async function recordProviderAccountUsage(input: {
  account: ProviderAccountRef;
  projectId?: string | null;
  runId?: string | null;
  candidateId?: string | null;
  operation: string;
  quantity?: number;
  status: string;
  idempotencyKey?: string | null;
}) {
  if (!db || !input.account.id) return;
  await db.insert(researchProviderAccountUsage).values({
    organizationId: MTI_ORGANIZATION_ID,
    accountId: input.account.id,
    projectId: input.projectId ?? null,
    runId: input.runId ?? null,
    candidateId: input.candidateId ?? null,
    operation: input.operation,
    quantity: input.quantity ?? 1,
    status: input.status,
    idempotencyKey: input.idempotencyKey ?? null
  }).onConflictDoNothing();
}

export async function updateProviderAccountHealth(
  account: ProviderAccountRef,
  input: { success?: boolean; error?: string; cooldownUntil?: Date; disable?: boolean }
) {
  if (!db || !account.id) return;
  await db.update(researchProviderAccounts).set({
    ...(input.success ? { lastSuccessAt: new Date(), lastError: null } : {}),
    ...(input.error ? { lastErrorAt: new Date(), lastError: input.error.slice(0, 2000) } : {}),
    ...(input.cooldownUntil ? { cooldownUntil: input.cooldownUntil } : {}),
    ...(input.disable ? { status: "disabled" } : {}),
    updatedAt: new Date()
  }).where(eq(researchProviderAccounts.id, account.id));
}

function periodStart(period: string, resetAt: Date | null, now: Date) {
  if (resetAt && resetAt > now) {
    const start = new Date(resetAt);
    if (period === "daily") start.setUTCDate(start.getUTCDate() - 1);
    else start.setUTCMonth(start.getUTCMonth() - 1);
    return start;
  }
  return period === "daily"
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
