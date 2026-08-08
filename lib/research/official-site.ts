import { createHash } from "node:crypto";
import { normalizeDomain } from "@/lib/company-research";
import {
  availableProviderAccounts,
  recordProviderAccountUsage,
  updateProviderAccountHealth,
  type ProviderAccountRef
} from "@/lib/research/accounts";

const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2";
const RELEVANT_PATH = /(about|company|leadership|management|team|product|service|solution|career|jobs|news|press|investor|location|contact|sustainab)/i;

class ProviderHttpError extends Error {
  constructor(public status: number, public retryAfterMs: number | null) {
    super(`HTTP ${status}`);
  }
}

export async function researchOfficialSite(input: {
  projectId: string;
  runId?: string | null;
  candidateId?: string | null;
  domain: string;
  maxPages?: number;
}, fetcher: typeof fetch = fetch) {
  const domain = normalizeDomain(input.domain);
  if (!domain) return { provider: "firecrawl", domain: null, pages: [], issues: ["Official domain is missing or invalid."] };
  const accounts = await availableProviderAccounts("firecrawl", [
    "FIRECRAWL_API_KEY", "FIRECRAWL_API_KEY_2", "FIRECRAWL_API_KEY_3"
  ]);
  if (accounts.length === 0) {
    return { provider: "firecrawl", domain, pages: [], issues: ["No authorized Firecrawl account is configured."] };
  }
  const issues: string[] = [];
  for (const account of accounts) {
    try {
      const pages = await mapAndScrape(account, `https://${domain}`, Math.min(10, Math.max(1, input.maxPages ?? 8)), input, fetcher);
      await updateProviderAccountHealth(account, { success: true });
      return { provider: "firecrawl", accountId: account.id, domain, pages, issues };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Firecrawl failed.";
      issues.push(`${account.label}: ${message}`);
      const status = error instanceof ProviderHttpError ? error.status : Number(message.match(/HTTP (\d+)/)?.[1] ?? 0);
      const cooldownUntil = status === 429
        ? new Date(Date.now() + (error instanceof ProviderHttpError ? error.retryAfterMs ?? 60_000 : 60_000))
        : status === 402
          ? account.resetAt ?? new Date(Date.now() + 86_400_000)
          : undefined;
      await updateProviderAccountHealth(account, {
        error: message,
        disable: status === 401 || status === 403,
        cooldownUntil
      });
    }
  }
  return { provider: "firecrawl", domain, pages: [], issues };
}

async function mapAndScrape(
  account: ProviderAccountRef,
  url: string,
  maxPages: number,
  scope: { projectId: string; runId?: string | null; candidateId?: string | null },
  fetcher: typeof fetch
) {
  const key = process.env[account.credentialEnv];
  if (!key) throw new Error("Credential reference is not configured.");
  // Firecrawl bills Map by discovered page, so cap discovery to twice the
  // number we can actually scrape. This preserves useful page selection while
  // keeping a default dossier at no more than 16 map + 8 scrape credits.
  const map = await firecrawlRequest(account, "map", { url, limit: Math.max(10, maxPages * 2) }, scope, fetcher, key);
  const links = extractLinks(map);
  const selected = selectPages(url, links, maxPages);
  const pages = [];
  for (const pageUrl of selected) {
    const payload = await firecrawlRequest(
      account, "scrape", { url: pageUrl, formats: ["markdown"], onlyMainContent: true }, scope, fetcher, key
    );
    const data = object(payload.data) ?? payload;
    const markdown = typeof data.markdown === "string" ? data.markdown.slice(0, 60_000) : "";
    if (!markdown) continue;
    const metadata = object(data.metadata) ?? {};
    pages.push({
      url: pageUrl,
      title: typeof metadata.title === "string" ? metadata.title : pageUrl,
      markdown,
      contentHash: createHash("sha256").update(markdown).digest("hex"),
      retrievedAt: new Date().toISOString()
    });
  }
  return pages;
}

async function firecrawlRequest(
  account: ProviderAccountRef,
  operation: "map" | "scrape",
  body: Record<string, unknown>,
  scope: { projectId: string; runId?: string | null; candidateId?: string | null },
  fetcher: typeof fetch,
  key: string
) {
  const idempotencyKey = createHash("sha256").update(`${operation}:${JSON.stringify(body)}`).digest("hex");
  const response = await fetcher(`${FIRECRAWL_BASE_URL}/${operation}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  await recordProviderAccountUsage({
    account, projectId: scope.projectId, runId: scope.runId, candidateId: scope.candidateId,
    operation, status: response.ok ? "completed" : `http_${response.status}`, idempotencyKey
  });
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
    throw new ProviderHttpError(response.status, Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null);
  }
  return await response.json() as Record<string, unknown>;
}

function extractLinks(payload: Record<string, unknown>) {
  const raw: unknown[] = Array.isArray(payload.links) ? payload.links : Array.isArray(object(payload.data)?.links) ? object(payload.data)!.links : [];
  return raw.flatMap((item: unknown) => typeof item === "string" ? [item] : object(item) && typeof object(item)!.url === "string" ? [String(object(item)!.url)] : []);
}

function selectPages(root: string, links: string[], maxPages: number) {
  const rootDomain = normalizeDomain(root);
  const unique = [...new Set([root, ...links])].filter((url) => normalizeDomain(url) === rootDomain);
  return unique.sort((a, b) => Number(RELEVANT_PATH.test(b)) - Number(RELEVANT_PATH.test(a))).slice(0, maxPages);
}

function object(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}
