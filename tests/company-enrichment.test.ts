import { describe, expect, it } from "vitest";
import {
  businessRegistrationNumber,
  companyResearchName,
  inferCompanyCountry,
  researchOfficialCompanyData
} from "@/lib/research/company-enrichment";

describe("official company enrichment", () => {
  it("infers supported countries from explicit and location fields", () => {
    expect(inferCompanyCountry({ countryCode: "KR" })).toBe("KR");
    expect(inferCompanyCountry({ location: "Seoul, South Korea" })).toBe("KR");
    expect(inferCompanyCountry({ country: "United States" })).toBe("US");
    expect(inferCompanyCountry({ location: "Paris, France" })).toBe("GLOBAL");
  });

  it("extracts stable company names and Korean business numbers", () => {
    expect(companyResearchName({ legalName: "Example Co." })).toBe("Example Co.");
    expect(businessRegistrationNumber({ businessNumber: "123-45-67890" })).toBe("1234567890");
    expect(businessRegistrationNumber({ businessNumber: "unknown" })).toBeNull();
  });

  it("limits a global company to one keyless GLEIF request", async () => {
    const calls: string[] = [];
    const result = await researchOfficialCompanyData({
      projectId: "10000000-0000-4000-8000-000000000001",
      runId: "10000000-0000-4000-8000-000000000002",
      candidateId: "10000000-0000-4000-8000-000000000003",
      company: { legalName: "Global Example", country: "France" }
    }, {
      fetcher: (async (url: string | URL | Request) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch,
      now: () => new Date("2026-08-08T00:00:00.000Z")
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("api.gleif.org");
    expect(result).toEqual([expect.objectContaining({ provider: "gleif", status: "available" })]);
  });

  it("honors a strategy that does not request registry enrichment", async () => {
    let calls = 0;
    const result = await researchOfficialCompanyData({
      projectId: "10000000-0000-4000-8000-000000000001",
      runId: "10000000-0000-4000-8000-000000000002",
      candidateId: "10000000-0000-4000-8000-000000000003",
      company: { legalName: "Example", countryCode: "US" },
      evidenceCapabilities: ["recent_news"]
    }, { fetcher: (async () => { calls += 1; return new Response("{}"); }) as typeof fetch });
    expect(calls).toBe(0);
    expect(result).toEqual([]);
  });
});
