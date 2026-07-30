import { afterEach, describe, expect, it } from "vitest";
import {
  flagResearchContradiction,
  getResearchQueryStatus,
  getResearchTestState,
  runResearchQuery,
  setResearchDomainPolicy
} from "@/lib/research/engine";
import { researchProviderCatalog } from "@/lib/research/providers";

const originalEnvironment = {
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  TAVILY_API_KEY_BACKUP: process.env.TAVILY_API_KEY_BACKUP
};

afterEach(() => {
  if (originalEnvironment.TAVILY_API_KEY === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = originalEnvironment.TAVILY_API_KEY;
  if (originalEnvironment.TAVILY_API_KEY_BACKUP === undefined) delete process.env.TAVILY_API_KEY_BACKUP;
  else process.env.TAVILY_API_KEY_BACKUP = originalEnvironment.TAVILY_API_KEY_BACKUP;
});

const ids = () => ({
  projectId: crypto.randomUUID(),
  agendaId: crypto.randomUUID()
});
const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });

describe("research provider governance", () => {
  it("registers every planned provider with policy, limits, and credentials", () => {
    // Brave is deliberately absent: Tavily is the only general web-search
    // provider, with a second Tavily key for redundancy instead.
    expect(researchProviderCatalog.map((item) => item.key)).toEqual([
      "tavily", "sec_edgar", "us_census", "world_bank", "fred",
      "korean_public_data", "kosis", "openalex", "crossref",
      "semantic_scholar", "wikimedia", "wikidata"
    ]);
    expect(researchProviderCatalog.filter((item) => item.category.includes("web")).map((item) => item.key))
      .toEqual(["tavily"]);
    for (const provider of researchProviderCatalog) {
      expect(provider.policyUrl).toMatch(/^https:/);
      expect(provider.requestsPerSecond).toBeGreaterThan(0);
      expect(provider.concurrency).toBeGreaterThan(0);
      expect(provider.cacheTtlSeconds).toBeGreaterThan(0);
    }
    expect(researchProviderCatalog.find((item) => item.key === "sec_edgar")?.requestsPerSecond)
      .toBeLessThan(10);
    expect(researchProviderCatalog.find((item) => item.key === "world_bank")?.requiresCredential)
      .toBe(false);
  });
});

describe("research execution", () => {
  it("falls over to the backup Tavily key and preserves original cited evidence", async () => {
    process.env.TAVILY_API_KEY = "primary-key";
    process.env.TAVILY_API_KEY_BACKUP = "backup-key";
    const keysUsed: string[] = [];
    const result = await runResearchQuery({
      ...ids(),
      query: `failover-${crypto.randomUUID()}`,
      category: "web",
      queryBudget: 2
    }, {
      sleep: async () => undefined,
      fetcher: async (_url, init) => {
        const key = JSON.parse(String(init?.body ?? "{}")).api_key as string;
        keysUsed.push(key);
        // The primary key is out of quota; the spare must get a real attempt.
        if (key === "primary-key") return json({ detail: "usage limit" }, 429);
        return json({
          results: [{
            title: "Backup key result",
            url: "https://example.com/backup",
            content: "Evidence returned after key failover."
          }]
        });
      }
    });

    expect(keysUsed.filter((key) => key === "primary-key").length).toBe(3); // retried, then abandoned
    expect(keysUsed).toContain("backup-key");
    // Still Tavily — failover must not hand the query to a different service.
    expect(result.evidence[0]).toMatchObject({
      provider: "tavily",
      url: "https://example.com/backup",
      cacheState: "miss"
    });
    expect(result.evidence[0].citation).toContain("retrieved");
    expect(result.evidence[0].originalEvidence).toMatchObject({ title: "Backup key result" });
  });

  it("does not fall back to another provider when Tavily has no key at all", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY_BACKUP;
    let calls = 0;

    const result = await runResearchQuery({
      ...ids(),
      query: `no-key-${crypto.randomUUID()}`,
      category: "web",
      queryBudget: 2
    }, { sleep: async () => undefined, fetcher: async () => { calls += 1; return json({}); } });

    // An unconfigured web search must surface as an outage, not quietly return
    // encyclopedia results that look like thin search coverage.
    expect(calls).toBe(0);
    expect(result.evidence).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      provider: "tavily",
      state: "unavailable",
      message: expect.stringContaining("TAVILY_API_KEY / TAVILY_API_KEY_BACKUP")
    }));
  });

  // Uses the "reference" category: wikimedia is a reference provider, not a
  // web-search fallback, so caching is exercised where it actually applies.
  it("caches normalized source responses and exposes source coverage", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY_BACKUP;
    const query = `cache-${crypto.randomUUID()}`;
    let calls = 0;
    // Wikidata shape: it has the lowest priority number among reference
    // providers, so with queryBudget 1 it is the one that gets called.
    const fetcher = async () => {
      calls += 1;
      return json({
        search: [{ id: "Q42", label: "Cache evidence", description: "Reusable source evidence." }]
      });
    };
    const first = await runResearchQuery({
      ...ids(), query, category: "reference", queryBudget: 1
    }, { fetcher, sleep: async () => undefined });
    const second = await runResearchQuery({
      ...ids(), query, category: "reference", queryBudget: 1
    }, { fetcher, sleep: async () => undefined });
    expect(calls).toBe(1);
    expect(first.evidence[0].cacheState).toBe("miss");
    expect(second.evidence[0].cacheState).toBe("hit");
    expect(second.coverage.providersAvailable).toEqual(["wikidata"]);
  });

  it("retries rate limits with Retry-After and marks stale academic evidence", async () => {
    const query = `stale-${crypto.randomUUID()}`;
    let calls = 0;
    const waits: number[] = [];
    const result = await runResearchQuery({
      ...ids(), query, category: "academic", queryBudget: 1
    }, {
      now: () => new Date("2026-07-29T00:00:00.000Z"),
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      fetcher: async () => {
        calls += 1;
        if (calls === 1) return json({}, 429, { "retry-after": "1" });
        return json({
          results: [{
            id: "https://openalex.org/W1",
            display_name: "Historical evidence",
            publication_year: 2010
          }]
        });
      }
    });
    expect(calls).toBe(2);
    expect(waits).toContain(1000);
    expect(result.evidence[0].evidenceState).toBe("stale");
    expect(result.coverage.stale).toBe(1);
    expect(getResearchTestState().attempts.some((item) =>
      item.queryId === result.queryId && item.status === "rate_limited"
    )).toBe(true);
  });

  it("persists contradictions and exposes them with query state", async () => {
    const query = `contradiction-${crypto.randomUUID()}`;
    const result = await runResearchQuery({
      ...ids(), query, category: "reference", queryBudget: 1, maxResults: 2
    }, {
      sleep: async () => undefined,
      fetcher: async () => json({
        search: [
          { id: "Q1", label: "Source A", description: "Value is 10." },
          { id: "Q2", label: "Source B", description: "Value is 20." }
        ]
      })
    });
    const contradiction = await flagResearchContradiction({
      queryId: result.queryId,
      claimKey: "reported-value",
      evidenceIds: result.evidence.map((item) => item.id),
      description: "Sources report different values."
    });
    expect(contradiction).toMatchObject({ status: "unresolved" });
    const status = await getResearchQueryStatus(result.queryId);
    expect(status?.states.contradictory).toBe(2);
    expect(status?.contradictions).toHaveLength(1);
  });

  it("blocks provider calls through durable domain policy", async () => {
    await setResearchDomainPolicy({
      domain: "www.wikidata.org",
      access: "block",
      reason: "Compliance review."
    });
    const urls: string[] = [];
    const result = await runResearchQuery({
      ...ids(),
      query: `blocked-${crypto.randomUUID()}`,
      category: "reference",
      queryBudget: 1
    }, {
      sleep: async () => undefined,
      fetcher: async (url) => {
        urls.push(String(url));
        return json({});
      }
    });
    expect(urls.some((url) => url.includes("wikidata.org"))).toBe(false);
    expect(urls.some((url) => url.includes("wikipedia.org"))).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({
      provider: "wikidata",
      state: "blocked"
    }));
    await setResearchDomainPolicy({ domain: "www.wikidata.org", access: "allow" });
  });
});
