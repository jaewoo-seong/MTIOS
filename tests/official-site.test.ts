import { afterEach, describe, expect, it } from "vitest";
import { researchOfficialSite } from "@/lib/research/official-site";

const originalKeys = ["FIRECRAWL_API_KEY", "FIRECRAWL_API_KEY_2", "FIRECRAWL_API_KEY_3"]
  .map((name) => [name, process.env[name]] as const);
afterEach(() => {
  for (const [name, value] of originalKeys) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("Firecrawl official-site research", () => {
  it("maps a domain and scrapes only the bounded relevant pages", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    const scraped: string[] = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      const endpoint = String(url);
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (endpoint.endsWith("/map")) {
        return Response.json({ links: [
          "https://acme.co/privacy", "https://acme.co/about", "https://acme.co/careers", "https://outside.test/about"
        ] });
      }
      scraped.push(body.url);
      return Response.json({ data: { markdown: `# ${body.url}\nVerified company content.`, metadata: { title: body.url } } });
    };
    const result = await researchOfficialSite({
      projectId: crypto.randomUUID(), domain: "https://www.acme.co/about", maxPages: 2
    }, fetcher as typeof fetch);
    expect(result.pages).toHaveLength(2);
    expect(scraped).toContain("https://acme.co/about");
    expect(scraped.every((url) => url.includes("acme.co"))).toBe(true);
    expect(result.pages[0]).toHaveProperty("contentHash");
  });

  it("reports missing credentials without attempting the network", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY_2;
    delete process.env.FIRECRAWL_API_KEY_3;
    let calls = 0;
    const result = await researchOfficialSite({
      projectId: crypto.randomUUID(), domain: "acme.co"
    }, (async () => { calls += 1; return Response.json({}); }) as typeof fetch);
    expect(calls).toBe(0);
    expect(result.issues[0]).toContain("No authorized Firecrawl account");
  });
});
