import { createHash } from "node:crypto";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  researchCache,
  researchContradictions,
  researchDomainPolicies,
  researchEvidence,
  researchProviderAttempts,
  researchProviders,
  researchQueries
} from "@/lib/db/schema";
import {
  providersFor,
  researchProviderCatalog,
  type ResearchCategory,
  type ResearchProviderDefinition
} from "@/lib/research/providers";
import { MTI_ORGANIZATION_ID } from "@/lib/repository";
import {
  providerQuotaAvailable,
  recordExternalProviderUsage
} from "@/lib/ai/usage";
import { logResearchQuery } from "@/lib/observability/logger";
import {
  availableProviderAccounts,
  recordProviderAccountUsage,
  updateProviderAccountHealth,
  type ProviderAccountRef
} from "@/lib/research/accounts";

export type NormalizedEvidence = {
  id: string;
  queryId: string;
  provider: string;
  publisher: string;
  title: string;
  url: string;
  excerpt: string;
  originalEvidence: Record<string, unknown>;
  language: string;
  license: string | null;
  contentHash: string;
  citation: string;
  confidence: number;
  qualityScore: number;
  evidenceState: "available" | "stale" | "low_confidence" | "contradictory";
  cacheState: "hit" | "miss";
  publishedAt: string | null;
  retrievedAt: string;
};

type AdapterResult = Omit<NormalizedEvidence, "id" | "queryId" | "provider" | "contentHash" | "citation" | "confidence" | "qualityScore" | "evidenceState" | "cacheState" | "retrievedAt">;
type Fetcher = typeof fetch;
type ResearchMemory = {
  providers: Array<ResearchProviderDefinition & { id: string }>;
  queries: Array<Record<string, unknown>>;
  evidence: NormalizedEvidence[];
  attempts: Array<Record<string, unknown>>;
  contradictions: Array<Record<string, unknown>>;
  domainPolicies: Array<Record<string, unknown>>;
  cache: Map<string, { expiresAt: number; results: AdapterResult[] }>;
};
const globalResearchSources = globalThis as typeof globalThis & { __researchSourceMemory?: ResearchMemory };
const memory: ResearchMemory = globalResearchSources.__researchSourceMemory ??= {
  providers: [],
  queries: [],
  evidence: [],
  attempts: [],
  contradictions: [],
  domainPolicies: [],
  cache: new Map()
};
const lastRequestAt = new Map<string, number>();

export async function registerResearchProviders() {
  if (!db) {
    memory.providers = researchProviderCatalog.map((provider) => ({
      ...provider,
      id: memory.providers.find((item) => item.key === provider.key)?.id ?? crypto.randomUUID()
    }));
    memory.domainPolicies = researchProviderCatalog.map((provider) => {
      const domain = new URL(provider.baseUrl).hostname;
      return memory.domainPolicies.find((item) => item.domain === domain) ?? {
        id: crypto.randomUUID(),
        domain,
        access: "allow",
        robotsPolicy: "api_terms",
        requestsPerSecond: provider.requestsPerSecond,
        reason: provider.policyUrl
      };
    });
    return memory.providers;
  }
  for (const provider of researchProviderCatalog) {
    await db.insert(researchProviders).values({
      organizationId: MTI_ORGANIZATION_ID,
      key: provider.key,
      name: provider.name,
      category: provider.category.join(","),
      baseUrl: provider.baseUrl,
      credentialEnv: provider.credentialEnv,
      requiresCredential: provider.requiresCredential,
      priority: provider.priority,
      requestsPerSecond: provider.requestsPerSecond,
      concurrency: provider.concurrency,
      dailyQueryLimit: provider.dailyQueryLimit,
      cacheTtlSeconds: provider.cacheTtlSeconds,
      policyUrl: provider.policyUrl,
      policy: provider.policy
    }).onConflictDoUpdate({
      target: [researchProviders.organizationId, researchProviders.key],
      set: {
        name: provider.name,
        category: provider.category.join(","),
        baseUrl: provider.baseUrl,
        credentialEnv: provider.credentialEnv,
        requiresCredential: provider.requiresCredential,
        priority: provider.priority,
        requestsPerSecond: provider.requestsPerSecond,
        concurrency: provider.concurrency,
        dailyQueryLimit: provider.dailyQueryLimit,
        cacheTtlSeconds: provider.cacheTtlSeconds,
        policyUrl: provider.policyUrl,
        policy: provider.policy,
        active: true,
        updatedAt: new Date()
      }
    });
    const domain = new URL(provider.baseUrl).hostname;
    await db.insert(researchDomainPolicies).values({
      organizationId: MTI_ORGANIZATION_ID,
      domain,
      access: "allow",
      robotsPolicy: "api_terms",
      requestsPerSecond: provider.requestsPerSecond,
      reason: `Provider policy: ${provider.policyUrl}`,
      lastCheckedAt: new Date()
    }).onConflictDoUpdate({
      target: [researchDomainPolicies.organizationId, researchDomainPolicies.domain],
      set: {
        requestsPerSecond: provider.requestsPerSecond,
        reason: `Provider policy: ${provider.policyUrl}`,
        lastCheckedAt: new Date(),
        updatedAt: new Date()
      }
    });
  }
  return db.select().from(researchProviders).where(eq(researchProviders.organizationId, MTI_ORGANIZATION_ID));
}

export async function runResearchQuery(input: {
  projectId: string;
  agendaId: string;
  runId?: string | null;
  query: string;
  category: ResearchCategory;
  language?: string;
  queryBudget?: number;
  maxResults?: number;
}, options: {
  fetcher?: Fetcher;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
} = {}) {
  const providers = await registerResearchProviders();
  const queryId = crypto.randomUUID();
  const queryBudget = Math.max(1, Math.min(input.queryBudget ?? 10, 100));
  const queryRecord = {
    id: queryId,
    projectId: input.projectId,
    agendaId: input.agendaId,
    runId: input.runId ?? null,
    query: input.query,
    category: input.category,
    language: input.language ?? "en",
    status: "executing",
    queryBudget,
    queriesUsed: 0,
    costCents: 0
  };
  if (!db) memory.queries.push(queryRecord);
  else await db.insert(researchQueries).values({
    organizationId: MTI_ORGANIZATION_ID,
    ...queryRecord
  });

  const issues: Array<{ provider: string; state: string; message: string }> = [];
  const evidence: NormalizedEvidence[] = [];
  const candidates = providersFor(input.category);
  let used = 0;
  let costCents = 0;
  let fallbackFrom: string | null = null;
  for (const definition of candidates) {
    if (used >= queryBudget || evidence.length >= (input.maxResults ?? 20)) break;
    const legacyCredentialEnvs = [definition.credentialEnv, ...(definition.fallbackCredentialEnvs ?? [])]
      .filter((name): name is string => Boolean(name));
    const accounts = definition.requiresCredential
      ? await availableProviderAccounts(definition.key, legacyCredentialEnvs)
      : [];
    if (definition.requiresCredential && accounts.length === 0) {
      issues.push({
        provider: definition.key,
        state: "unavailable",
        message: `${[definition.credentialEnv, ...(definition.fallbackCredentialEnvs ?? [])]
          .filter(Boolean).join(" / ")} is not configured.`
      });
      fallbackFrom = definition.key;
      continue;
    }
    if (!await isProviderDomainAllowed(definition)) {
      issues.push({
        provider: definition.key,
        state: "blocked",
        message: `Domain policy blocks ${new URL(definition.baseUrl).hostname}.`
      });
      fallbackFrom = definition.key;
      continue;
    }
    // Independently owned account pools enforce their own allowance in
    // availableProviderAccounts. The legacy provider-wide quota remains the
    // safety net only when no managed accounts have been registered.
    const quota = accounts.some((account) => account.id)
      ? { available: true }
      : await providerQuotaAvailable(definition.key, "research");
    if (!quota.available) {
      issues.push({
        provider: definition.key,
        state: "quota_exhausted",
        message: `${definition.name} configured quota is exhausted.`
      });
      fallbackFrom = definition.key;
      continue;
    }
    used += 1;
    costCents += definition.costCents;
    const provider = providers.find((item) => item.key === definition.key);
    if (!provider) continue;
    const result = await queryProvider(
      queryId,
      provider.id,
      definition,
      input.query,
      input.language ?? "en",
      fallbackFrom,
      { projectId: input.projectId, runId: input.runId ?? null },
      options,
      accounts
    );
    if (result.issue) {
      issues.push(result.issue);
      fallbackFrom = definition.key;
      continue;
    }
    evidence.push(...result.evidence.slice(0, Math.max(0, (input.maxResults ?? 20) - evidence.length)));
    fallbackFrom = null;
    if (evidence.length > 0 && ["web", "company"].includes(input.category)) break;
  }

  const coverage = {
    providersAttempted: used,
    providersAvailable: [...new Set(evidence.map((item) => item.provider))],
    resultCount: evidence.length,
    unavailable: issues.filter((item) => item.state === "unavailable").length,
    rateLimited: issues.filter((item) => item.state === "rate_limited").length,
    stale: evidence.filter((item) => item.evidenceState === "stale").length,
    lowConfidence: evidence.filter((item) => item.evidenceState === "low_confidence").length
  };
  if (!db) {
    Object.assign(queryRecord, {
      status: evidence.length > 0 ? "completed" : "partial",
      queriesUsed: used,
      costCents,
      coverage
    });
  } else {
    await db.update(researchQueries).set({
      status: evidence.length > 0 ? "completed" : "partial",
      queriesUsed: used,
      costCents,
      coverage,
      updatedAt: new Date()
    }).where(and(
      eq(researchQueries.id, queryId),
      eq(researchQueries.organizationId, MTI_ORGANIZATION_ID)
    ));
  }
  return { queryId, evidence, issues, coverage, costCents };
}

/** Env var names for this provider that actually hold a value, in priority order. */
export function configuredCredentials(provider: ResearchProviderDefinition) {
  return [provider.credentialEnv, ...(provider.fallbackCredentialEnvs ?? [])]
    .filter((name): name is string => Boolean(name))
    .filter((name) => Boolean(process.env[name]));
}

async function queryProvider(
  queryId: string,
  providerId: string,
  provider: ResearchProviderDefinition,
  query: string,
  language: string,
  fallbackFrom: string | null,
  scope: { projectId: string; runId: string | null },
  options: {
    fetcher?: Fetcher;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => Date;
  },
  accounts: ProviderAccountRef[] = []
) {
  const started = Date.now();
  const cacheKey = hash(`${provider.key}|${language}|${query.trim().toLowerCase()}`);
  const cached = await readCache(providerId, cacheKey);
  if (cached) {
    const evidence = await persistEvidence(queryId, providerId, provider, cached, "hit", options.now?.() ?? new Date());
    await persistAttempt(queryId, providerId, {
      status: "cached", resultCount: evidence.length, durationMs: Date.now() - started, fallbackFrom
    });
    // A cache hit costs nothing, and recording that explicitly is what makes
    // the difference between "this campaign was cheap" and "this campaign was
    // cheap because reuse worked" visible.
    logResearchQuery({
      runId: scope.runId,
      provider: provider.key,
      costCents: 0,
      resultCount: evidence.length,
      cacheState: "hit",
      status: "cached"
    });
    return { evidence, issue: null };
  }

  // One pass per key. A key that is rate-limited or out of quota is a fact
  // about that key, not about the provider, so the spare key gets a full
  // attempt before the query gives up and moves to a different service.
  const keys: Array<ProviderAccountRef | null> = accounts.length > 0 ? accounts : [null];
  let issue: { provider: string; state: string; message: string } | null = null;
  for (const [index, account] of keys.entries()) {
    const attempt = await queryProviderWithKey(
      queryId, providerId, provider, query, language, fallbackFrom, scope, options,
      account, started, cacheKey
    );
    if (!attempt.issue) return attempt;
    issue = attempt.issue;
    const retryable = attempt.issue.state === "rate_limited" || attempt.issue.state === "unavailable";
    if (!retryable || index === keys.length - 1) break;
  }
  return { evidence: [], issue };
}

async function queryProviderWithKey(
  queryId: string,
  providerId: string,
  provider: ResearchProviderDefinition,
  query: string,
  language: string,
  fallbackFrom: string | null,
  scope: { projectId: string; runId: string | null },
  options: {
    fetcher?: Fetcher;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => Date;
  },
  account: ProviderAccountRef | null,
  started: number,
  cacheKey: string
) {
  const fetcher = options.fetcher ?? fetch;
  await respectRate(provider, options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
  let lastErrorMessage = "Provider request failed.";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await recordExternalProviderUsage({
        provider: provider.key,
        route: "research",
        projectId: scope.projectId,
        runId: scope.runId
      });
      const response = await executeAdapter(provider, query, language, fetcher, account?.credentialEnv ?? null);
      if (account) {
        await recordProviderAccountUsage({
          account, projectId: scope.projectId, runId: scope.runId,
          operation: "research", status: response.ok ? "completed" : `http_${response.status}`,
          idempotencyKey: `${queryId}:${attempt}:${account.credentialEnv}`
        });
      }
      if (response.status === 429 || response.status === 503) {
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), attempt);
        await persistAttempt(queryId, providerId, {
          status: "rate_limited",
          httpStatus: response.status,
          resultCount: 0,
          durationMs: Date.now() - started,
          retryAfterMs,
          attempt,
          fallbackFrom
        });
        if (attempt < 3) {
          await (options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(retryAfterMs);
          continue;
        }
        if (account) await updateProviderAccountHealth(account, {
          error: `HTTP ${response.status}`,
          cooldownUntil: new Date(Date.now() + retryAfterMs)
        });
        return {
          evidence: [],
          issue: { provider: provider.key, state: "rate_limited", message: `HTTP ${response.status}` }
        };
      }
      if (response.status === 401 || response.status === 403) {
        if (account) await updateProviderAccountHealth(account, { error: `HTTP ${response.status}`, disable: true });
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (account) await updateProviderAccountHealth(account, { success: true });
      const raw = await response.json() as unknown;
      const normalized = normalizeProviderResponse(provider, raw, query, language);
      await writeCache(providerId, cacheKey, normalized, provider.cacheTtlSeconds);
      const evidence = await persistEvidence(
        queryId,
        providerId,
        provider,
        normalized,
        "miss",
        options.now?.() ?? new Date()
      );
      await persistAttempt(queryId, providerId, {
        status: "completed",
        httpStatus: response.status,
        resultCount: evidence.length,
        durationMs: Date.now() - started,
        attempt,
        fallbackFrom
      });
      // The paid path. `costCents` here is the provider's per-query price, which
      // is the figure that scales with entity count on a large campaign and was
      // invisible to budgets until recently.
      logResearchQuery({
        runId: scope.runId,
        provider: provider.key,
        costCents: provider.costCents,
        resultCount: evidence.length,
        cacheState: "miss",
        status: "completed"
      });
      return { evidence, issue: null };
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : "Provider request failed.";
      if (account) await updateProviderAccountHealth(account, { error: lastErrorMessage });
      if (attempt < 3) {
        await (options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(250 * 2 ** (attempt - 1));
      }
    }
  }
  await persistAttempt(queryId, providerId, {
    status: "failed",
    resultCount: 0,
    durationMs: Date.now() - started,
    error: lastErrorMessage,
    attempt: 3,
    fallbackFrom
  });
  return {
    evidence: [],
    issue: { provider: provider.key, state: "unavailable", message: lastErrorMessage }
  };
}

async function executeAdapter(
  provider: ResearchProviderDefinition,
  query: string,
  language: string,
  fetcher: Fetcher,
  /**
   * Which env var supplies this attempt's credential. Passed in rather than
   * read inline so a provider with more than one key (Tavily) can be retried
   * on its spare without this function knowing anything about failover.
   */
  credentialEnv: string | null = provider.credentialEnv
) {
  const credential = credentialEnv ? process.env[credentialEnv] : undefined;
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": process.env.RESEARCH_USER_AGENT ?? "MTI-Business-OS/1.0 (contact: operator@mti.local)"
  };
  let url = provider.baseUrl;
  let method = "GET";
  let body: string | undefined;
  if (provider.key === "tavily") {
    method = "POST";
    body = JSON.stringify({ api_key: credential, query, max_results: 10 });
    headers["content-type"] = "application/json";
  } else if (provider.key === "sec_edgar") {
    url += `?q=${encodeURIComponent(query)}&dateRange=all`;
  } else if (provider.key === "us_census") {
    const key = credential ? `&key=${encodeURIComponent(credential)}` : "";
    url += `/2022/cbp?get=NAME,NAICS2017_LABEL,ESTAB&for=state:*${key}`;
  } else if (provider.key === "world_bank") {
    url += `/country/all/indicator/${encodeURIComponent(query)}?format=json&per_page=20`;
  } else if (provider.key === "fred") {
    url += `/series/search?api_key=${encodeURIComponent(credential ?? "")}&file_type=json&search_text=${encodeURIComponent(query)}`;
  } else if (provider.key === "korean_public_data") {
    const endpoint = process.env.KOREAN_PUBLIC_DATA_ENDPOINT;
    if (!endpoint) throw new Error("KOREAN_PUBLIC_DATA_ENDPOINT is not configured for a selected dataset.");
    url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}serviceKey=${encodeURIComponent(credential ?? "")}&type=json&query=${encodeURIComponent(query)}`;
  } else if (provider.key === "kosis") {
    const endpoint = process.env.KOSIS_API_ENDPOINT;
    if (!endpoint) throw new Error("KOSIS_API_ENDPOINT is not configured for a selected statistic.");
    url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(credential ?? "")}&format=json&searchNm=${encodeURIComponent(query)}`;
  } else if (provider.key === "openalex") {
    const apiKey = process.env.OPENALEX_API_KEY ? `&api_key=${encodeURIComponent(process.env.OPENALEX_API_KEY)}` : "";
    url += `/works?search=${encodeURIComponent(query)}&per-page=10${apiKey}`;
  } else if (provider.key === "crossref") {
    const mailto = process.env.RESEARCH_CONTACT_EMAIL
      ? `&mailto=${encodeURIComponent(process.env.RESEARCH_CONTACT_EMAIL)}`
      : "";
    url += `/works?query=${encodeURIComponent(query)}&rows=10${mailto}`;
  } else if (provider.key === "semantic_scholar") {
    url += `/paper/search?query=${encodeURIComponent(query)}&limit=10&fields=title,url,abstract,year,authors,externalIds`;
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
      headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    }
  } else if (provider.key === "wikimedia") {
    url += `?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=10&format=json&utf8=1&maxlag=1&uselang=${encodeURIComponent(language)}`;
  } else if (provider.key === "wikidata") {
    url += `?action=wbsearchentities&search=${encodeURIComponent(query)}&language=${encodeURIComponent(language)}&limit=10&format=json&maxlag=1`;
  }
  return fetcher(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
}

function normalizeProviderResponse(
  provider: ResearchProviderDefinition,
  raw: unknown,
  query: string,
  language: string
): AdapterResult[] {
  const data = raw as Record<string, unknown>;
  const records: Array<Record<string, unknown>> =
    provider.key === "tavily" ? arrayAt(data, "results") :
    provider.key === "brave" ? arrayAt(data, "web", "results") :
    provider.key === "sec_edgar" ? arrayAt(data, "hits", "hits").map((item) => objectAt(item, "_source")) :
    provider.key === "world_bank" ? (Array.isArray(raw) && Array.isArray(raw[1]) ? raw[1] as Array<Record<string, unknown>> : []) :
    provider.key === "fred" ? arrayAt(data, "seriess") :
    provider.key === "openalex" ? arrayAt(data, "results") :
    provider.key === "crossref" ? arrayAt(data, "message", "items") :
    provider.key === "semantic_scholar" ? arrayAt(data, "data") :
    provider.key === "wikimedia" ? arrayAt(data, "query", "search") :
    provider.key === "wikidata" ? arrayAt(data, "search") :
    provider.key === "us_census" && Array.isArray(raw) ? censusRows(raw) :
    Array.isArray(raw) ? raw.filter(isRecord) : arrayAt(data, "response", "body", "items", "item");

  return records.map((record, index) => {
    const title = firstString(record, ["title", "name", "series_title", "label", "_name"]) ||
      `${provider.name} result ${index + 1}`;
    const directUrl = firstString(record, ["url", "resource_uri", "id"]);
    const url = directUrl.startsWith("http") ? directUrl : providerUrl(provider, record, query);
    const excerpt = stripMarkup(firstString(record, [
      "content", "snippet", "abstract", "description", "display_name", "value", "label"
    ]) || JSON.stringify(record).slice(0, 1200));
    const publishedAt = dateString(record);
    return {
      publisher: provider.name,
      title,
      url,
      excerpt,
      originalEvidence: record,
      language,
      license: provider.key === "openalex" ? "CC0" :
        ["wikimedia", "wikidata"].includes(provider.key) ? "Wikimedia project license" :
        provider.category.includes("government") ? "Public government data; dataset terms apply" : null,
      publishedAt
    };
  }).filter((item) => item.url.startsWith("http"));
}

async function persistEvidence(
  queryId: string,
  providerId: string,
  provider: ResearchProviderDefinition,
  results: AdapterResult[],
  cacheState: "hit" | "miss",
  now: Date
) {
  const normalized = results.map((result) => {
    const contentHash = hash(JSON.stringify({
      url: result.url,
      title: result.title,
      originalEvidence: result.originalEvidence
    }));
    const published = result.publishedAt ? new Date(result.publishedAt) : null;
    const stale = published && Number.isFinite(published.getTime()) &&
      now.getTime() - published.getTime() > 1000 * 60 * 60 * 24 * 365 * 5;
    const qualityScore = provider.qualityScore;
    const confidence = Math.min(100, Math.round(qualityScore * (result.excerpt ? 1 : 0.75)));
    const evidenceState = stale ? "stale" as const :
      confidence < 60 ? "low_confidence" as const : "available" as const;
    return {
      id: crypto.randomUUID(),
      queryId,
      provider: provider.key,
      ...result,
      contentHash,
      citation: `${result.title}. ${result.publisher}. ${result.url} (retrieved ${now.toISOString()})`,
      confidence,
      qualityScore,
      evidenceState,
      cacheState,
      retrievedAt: now.toISOString()
    };
  });
  if (!db) {
    memory.evidence.push(...normalized);
    return normalized;
  }
  const rows = [];
  for (const item of normalized) {
    const [row] = await db.insert(researchEvidence).values({
      id: item.id,
      organizationId: MTI_ORGANIZATION_ID,
      queryId,
      providerId,
      publisher: item.publisher,
      title: item.title,
      url: item.url,
      excerpt: item.excerpt,
      originalEvidence: item.originalEvidence,
      language: item.language,
      license: item.license,
      contentHash: item.contentHash,
      citation: item.citation,
      confidence: item.confidence,
      qualityScore: item.qualityScore,
      evidenceState: item.evidenceState,
      cacheState,
      publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
      retrievedAt: now,
      expiresAt: new Date(now.getTime() + provider.cacheTtlSeconds * 1000)
    }).onConflictDoNothing().returning();
    if (row) rows.push(item);
  }
  return rows;
}

async function persistAttempt(
  queryId: string,
  providerId: string,
  input: {
    status: string;
    resultCount: number;
    durationMs: number;
    attempt?: number;
    httpStatus?: number;
    retryAfterMs?: number;
    fallbackFrom?: string | null;
    error?: string;
  }
) {
  const record = { id: crypto.randomUUID(), queryId, providerId, attempt: 1, ...input };
  if (!db) {
    memory.attempts.push(record);
    return;
  }
  await db.insert(researchProviderAttempts).values({
    organizationId: MTI_ORGANIZATION_ID,
    queryId,
    providerId,
    ...input
  });
}

async function readCache(providerId: string, cacheKey: string) {
  const local = memory.cache.get(`${providerId}:${cacheKey}`);
  if (local && local.expiresAt > Date.now()) return local.results;
  if (!db) return null;
  const [row] = await db.select().from(researchCache).where(and(
    eq(researchCache.organizationId, MTI_ORGANIZATION_ID),
    eq(researchCache.providerId, providerId),
    eq(researchCache.cacheKey, cacheKey)
  )).limit(1);
  if (!row || row.expiresAt <= new Date()) return null;
  await db.update(researchCache).set({
    hitCount: row.hitCount + 1,
    updatedAt: new Date()
  }).where(eq(researchCache.id, row.id));
  return (row.response.results ?? []) as AdapterResult[];
}

async function writeCache(
  providerId: string,
  cacheKey: string,
  results: AdapterResult[],
  ttlSeconds: number
) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  memory.cache.set(`${providerId}:${cacheKey}`, { expiresAt: expiresAt.getTime(), results });
  if (!db) return;
  await db.insert(researchCache).values({
    organizationId: MTI_ORGANIZATION_ID,
    providerId,
    cacheKey,
    response: { results },
    expiresAt
  }).onConflictDoUpdate({
    target: [researchCache.providerId, researchCache.cacheKey],
    set: { response: { results }, expiresAt, updatedAt: new Date() }
  });
}

async function respectRate(provider: ResearchProviderDefinition, sleep: (milliseconds: number) => Promise<void>) {
  const minimumInterval = Math.ceil(1000 / provider.requestsPerSecond);
  const previous = lastRequestAt.get(provider.key) ?? 0;
  const wait = Math.max(0, minimumInterval - (Date.now() - previous));
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(provider.key, Date.now());
}

function parseRetryAfter(value: string | null, attempt: number) {
  if (!value) return Math.min(8000, 500 * 2 ** (attempt - 1));
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(30000, Math.max(250, seconds * 1000));
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? Math.min(30000, Math.max(250, date.getTime() - Date.now()))
    : 1000;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function objectAt(value: Record<string, unknown>, key: string) {
  return isRecord(value[key]) ? value[key] as Record<string, unknown> : {};
}
function arrayAt(root: Record<string, unknown>, ...path: string[]): Array<Record<string, unknown>> {
  let value: unknown = root;
  for (const key of path) value = isRecord(value) ? value[key] : undefined;
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}
function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return "";
}
function stripMarkup(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000);
}
function dateString(record: Record<string, unknown>) {
  const value = firstString(record, ["published", "publication_date", "created_date", "date"]);
  if (value) return value;
  const year = record.publication_year ?? record.year;
  return typeof year === "number" ? `${year}-01-01T00:00:00.000Z` : null;
}
function providerUrl(provider: ResearchProviderDefinition, record: Record<string, unknown>, query: string) {
  if (provider.key === "wikimedia" && typeof record.pageid === "number") {
    return `https://en.wikipedia.org/?curid=${record.pageid}`;
  }
  if (provider.key === "wikidata" && typeof record.id === "string") {
    return `https://www.wikidata.org/wiki/${record.id}`;
  }
  if (provider.key === "crossref") {
    const doi = firstString(record, ["DOI"]);
    if (doi) return `https://doi.org/${doi}`;
  }
  if (provider.key === "world_bank") {
    return `https://data.worldbank.org/indicator/${encodeURIComponent(query)}`;
  }
  return provider.baseUrl;
}
function censusRows(raw: unknown[]) {
  const [headers, ...rows] = raw;
  if (!Array.isArray(headers)) return [];
  return rows.filter(Array.isArray).map((row) =>
    Object.fromEntries(headers.map((key, index) => [String(key), row[index]]))
  );
}

/**
 * Total external research spend charged to one run, in whole cents.
 *
 * Read from `research_queries.cost_cents`, the same figure the research
 * surface reports, rather than a second tally that could drift from it. This
 * is deliberately separate from `runs.cost_micros`, which only ever tracks
 * model calls - the two costs come from different ledgers because they are
 * incurred by different systems, and a campaign budget needs to see both.
 */
export async function getRunResearchCostCents(runId: string): Promise<number> {
  if (!db) {
    return memory.queries
      .filter((query) => query.runId === runId)
      .reduce((sum, query) => sum + (typeof query.costCents === "number" ? query.costCents : 0), 0);
  }
  const [row] = await db.select({
    total: drizzleSql<number>`coalesce(sum(${researchQueries.costCents}), 0)::int`
  }).from(researchQueries).where(and(
    eq(researchQueries.organizationId, MTI_ORGANIZATION_ID),
    eq(researchQueries.runId, runId)
  ));
  return row?.total ?? 0;
}

export function getResearchTestState() {
  return memory;
}

export async function setResearchDomainPolicy(input: {
  domain: string;
  access: "allow" | "block";
  robotsPolicy?: "respect" | "api_terms" | "manual_review";
  requestsPerSecond?: number;
  reason?: string | null;
}) {
  const domain = input.domain.trim().toLowerCase();
  if (!db) {
    const existing = memory.domainPolicies.find((item) => item.domain === domain);
    const record = {
      ...(existing ?? { id: crypto.randomUUID() }),
      ...input,
      domain,
      robotsPolicy: input.robotsPolicy ?? "respect",
      requestsPerSecond: input.requestsPerSecond ?? 1
    };
    if (existing) Object.assign(existing, record);
    else memory.domainPolicies.push(record);
    return record;
  }
  const [record] = await db.insert(researchDomainPolicies).values({
    organizationId: MTI_ORGANIZATION_ID,
    domain,
    access: input.access,
    robotsPolicy: input.robotsPolicy ?? "respect",
    requestsPerSecond: input.requestsPerSecond ?? 1,
    reason: input.reason ?? null,
    lastCheckedAt: new Date()
  }).onConflictDoUpdate({
    target: [researchDomainPolicies.organizationId, researchDomainPolicies.domain],
    set: {
      access: input.access,
      robotsPolicy: input.robotsPolicy ?? "respect",
      requestsPerSecond: input.requestsPerSecond ?? 1,
      reason: input.reason ?? null,
      lastCheckedAt: new Date(),
      updatedAt: new Date()
    }
  }).returning();
  return record;
}

async function isProviderDomainAllowed(provider: ResearchProviderDefinition) {
  const domain = new URL(provider.baseUrl).hostname;
  if (!db) {
    return memory.domainPolicies.find((item) => item.domain === domain)?.access !== "block";
  }
  const [policy] = await db.select({ access: researchDomainPolicies.access })
    .from(researchDomainPolicies)
    .where(and(
      eq(researchDomainPolicies.organizationId, MTI_ORGANIZATION_ID),
      eq(researchDomainPolicies.domain, domain)
    )).limit(1);
  return policy?.access !== "block";
}

export async function flagResearchContradiction(input: {
  queryId: string;
  claimKey: string;
  evidenceIds: string[];
  description: string;
}) {
  if (input.evidenceIds.length < 2) throw new Error("Contradictions require at least two evidence records.");
  if (!db) {
    const record = {
      id: crypto.randomUUID(),
      ...input,
      status: "unresolved",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    memory.contradictions.push(record);
    for (const evidence of memory.evidence.filter((item) => input.evidenceIds.includes(item.id))) {
      evidence.evidenceState = "contradictory";
    }
    return record;
  }
  return db.transaction(async (tx) => {
    const [record] = await tx.insert(researchContradictions).values({
      organizationId: MTI_ORGANIZATION_ID,
      ...input
    }).onConflictDoUpdate({
      target: [researchContradictions.queryId, researchContradictions.claimKey],
      set: {
        evidenceIds: input.evidenceIds,
        description: input.description,
        status: "unresolved",
        updatedAt: new Date()
      }
    }).returning();
    await tx.update(researchEvidence).set({
      evidenceState: "contradictory",
      updatedAt: new Date()
    }).where(eq(researchEvidence.queryId, input.queryId));
    return record;
  });
}

export async function getResearchQueryStatus(queryId: string) {
  if (!db) {
    const query = memory.queries.find((item) => item.id === queryId);
    if (!query) return null;
    const evidence = memory.evidence.filter((item) => item.queryId === queryId);
    return {
      query,
      evidence,
      attempts: memory.attempts.filter((item) => item.queryId === queryId),
      contradictions: memory.contradictions.filter((item) => item.queryId === queryId),
      states: summarizeStates(evidence)
    };
  }
  const [query] = await db.select().from(researchQueries).where(and(
    eq(researchQueries.id, queryId),
    eq(researchQueries.organizationId, MTI_ORGANIZATION_ID)
  )).limit(1);
  if (!query) return null;
  const [evidence, attempts, contradictions] = await Promise.all([
    db.select().from(researchEvidence).where(eq(researchEvidence.queryId, queryId)),
    db.select().from(researchProviderAttempts).where(eq(researchProviderAttempts.queryId, queryId)),
    db.select().from(researchContradictions).where(eq(researchContradictions.queryId, queryId))
  ]);
  return { query, evidence, attempts, contradictions, states: summarizeStates(evidence) };
}

function summarizeStates(evidence: Array<{ evidenceState: string }>) {
  return Object.fromEntries(
    ["available", "stale", "low_confidence", "contradictory"]
      .map((state) => [state, evidence.filter((item) => item.evidenceState === state).length])
  );
}
