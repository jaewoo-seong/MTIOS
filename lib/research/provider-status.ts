import { createHash } from "node:crypto";

export type CredentialState = "missing" | "example" | "configured";
export type ProviderKeyStatus = {
  name: string;
  present: boolean;
  state: CredentialState | "ok" | "invalid" | "exhausted" | "unavailable";
  checkedAt: string | null;
  usage?: Record<string, unknown>;
};

const STATUS_TTL_MS = 60 * 60 * 1000;
const statusCache = new Map<string, { expiresAt: number; value: ProviderKeyStatus }>();

export function credentialState(value: string | undefined): CredentialState {
  const trimmed = value?.trim();
  if (!trimmed) return "missing";
  if (/^(example|sample|placeholder|changeme|replace[-_ ]?me|your[-_ ]?(api[-_ ]?)?key|xxx+)/i.test(trimmed) ||
      /(your[-_ ]?api[-_ ]?key|example[-_ ]?api[-_ ]?key|paste[-_ ]?key[-_ ]?here)/i.test(trimmed)) return "example";
  return "configured";
}

export function hasUsableCredential(name: string) {
  return credentialState(process.env[name]) === "configured";
}

export async function checkProviderKeys(provider: "tavily" | "firecrawl", names: string[]) {
  return Promise.all(names.map((name) => checkProviderKey(provider, name)));
}

async function checkProviderKey(provider: "tavily" | "firecrawl", name: string): Promise<ProviderKeyStatus> {
  const key = process.env[name];
  const initial = credentialState(key);
  if (initial !== "configured") return { name, present: initial !== "missing", state: initial, checkedAt: null };
  const fingerprint = createHash("sha256").update(key!).digest("hex").slice(0, 16);
  const cacheKey = `${provider}:${name}:${fingerprint}`;
  const cached = statusCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const checkedAt = new Date().toISOString();
  let value: ProviderKeyStatus;
  try {
    const response = await fetch(provider === "tavily" ? "https://api.tavily.com/usage" : "https://api.firecrawl.dev/v1/team/credit-usage", {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000), cache: "no-store"
    });
    if (response.status === 401 || response.status === 403) value = { name, present: true, state: "invalid", checkedAt };
    else if (!response.ok) value = { name, present: true, state: "unavailable", checkedAt };
    else {
      const raw = await response.json() as Record<string, unknown>;
      const usage = provider === "tavily" ? tavilySummary(raw) : firecrawlSummary(raw);
      value = { name, present: true, state: usage.remaining === 0 ? "exhausted" : "ok", checkedAt, usage };
    }
  } catch { value = { name, present: true, state: "unavailable", checkedAt }; }
  statusCache.set(cacheKey, { expiresAt: Date.now() + STATUS_TTL_MS, value });
  return value;
}

function tavilySummary(raw: Record<string, unknown>) {
  const key = object(raw.key); const account = object(raw.account);
  const used = number(account.plan_usage) ?? number(key.usage);
  const limit = number(account.plan_limit) ?? number(key.limit);
  return { plan: string(account.current_plan), used, limit, remaining: used !== null && limit !== null ? Math.max(0, limit - used) : null, paygoUsed: number(account.paygo_usage), paygoLimit: number(account.paygo_limit) };
}
function firecrawlSummary(raw: Record<string, unknown>) {
  const data = object(raw.data);
  return { remaining: number(data.remaining_credits), limit: number(data.plan_credits), periodStart: string(data.billing_period_start), periodEnd: string(data.billing_period_end) };
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function string(value: unknown) { return typeof value === "string" ? value : null; }
