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
  BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY
};

afterEach(() => {
  if (originalEnvironment.TAVILY_API_KEY === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = originalEnvironment.TAVILY_API_KEY;
  if (originalEnvironment.BRAVE_SEARCH_API_KEY === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
  else process.env.BRAVE_SEARCH_API_KEY = originalEnvironment.BRAVE_SEARCH_API_KEY;
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
    expect(researchProviderCatalog.map((item) => item.key)).toEqual([
      "tavily", "brave", "sec_edgar", "us_census", "world_bank", "fred",
      "korean_public_data", "kosis", "openalex", "crossref",
      "semantic_scholar", "wikimedia", "wikidata"
    ]);
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
  it("uses bounded provider fallback and preserves original cited evidence", async () => {
    process.env.TAVILY_API_KEY = "test";
    process.env.BRAVE_SEARCH_API_KEY = "test";
    let tavilyCalls = 0;
    const result = await runResearchQuery({
      ...ids(),
      query: `fallback-${crypto.randomUUID()}`,
      category: "web",
      queryBudget: 2
    }, {
      sleep: async () => undefined,
      fetcher: async (url) => {
        if (String(url).includes("tavily")) {
          tavilyCalls += 1;
          throw new Error("Primary provider unavailable.");
        }
        return json({
          web: {
            results: [{
              title: "Fallback result",
              url: "https://example.com/fallback",
              description: "Evidence returned by bounded fallback."
            }]
          }
        });
      }
    });
    expect(tavilyCalls).toBe(3);
    expect(result.coverage.providersAttempted).toBe(2);
    expect(result.evidence[0]).toMatchObject({
      provider: "brave",
      publisher: "Brave Search",
      url: "https://example.com/fallback",
      cacheState: "miss"
    });
    expect(result.evidence[0].citation).toContain("retrieved");
    expect(result.evidence[0].originalEvidence).toMatchObject({ title: "Fallback result" });
    expect(result.issues).toContainEqual(expect.objectContaining({
      provider: "tavily",
      state: "unavailable"
    }));
  });

  it("caches normalized source responses and exposes source coverage", async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    const query = `cache-${crypto.randomUUID()}`;
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return json({
        query: {
          search: [{
            pageid: 42,
            title: "Cache evidence",
            snippet: "Reusable source evidence."
          }]
        }
      });
    };
    const first = await runResearchQuery({
      ...ids(), query, category: "web", queryBudget: 1
    }, { fetcher, sleep: async () => undefined });
    const second = await runResearchQuery({
      ...ids(), query, category: "web", queryBudget: 1
    }, { fetcher, sleep: async () => undefined });
    expect(calls).toBe(1);
    expect(first.evidence[0].cacheState).toBe("miss");
    expect(second.evidence[0].cacheState).toBe("hit");
    expect(second.coverage.providersAvailable).toEqual(["wikimedia"]);
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
