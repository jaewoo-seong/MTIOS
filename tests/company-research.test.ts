import { describe, expect, it } from "vitest";
import {
  addCampaignCandidate,
  claimCandidate,
  createResearchCampaign,
  findCompanyMatches,
  getCampaignCoverage,
  markCampaignSaturated,
  normalizeCompanyName,
  normalizeDomain,
  registerCompany,
  releaseCandidateClaim
} from "@/lib/company-research";
import { repository } from "@/lib/repository";

describe("canonical company identity", () => {
  it("normalizes legal suffixes and domains deterministically", () => {
    expect(normalizeCompanyName("ACME Corporation, Ltd.")).toBe("acme");
    expect(normalizeDomain("https://www.Example.com/about")).toBe("example.com");
  });

  it("reuses official identifiers before names and domains", async () => {
    const created = await registerCompany({
      legalName: "Identity Verification Holdings",
      domain: "identity-verification.example",
      countryCode: "US",
      identifiers: [{ type: "lei", value: "TEST-LEI-0001" }]
    });
    expect(created.created).toBe(true);

    const matches = await findCompanyMatches({
      legalName: "Different Trading Name",
      domain: "different.example",
      countryCode: "US",
      identifiers: [{ type: "LEI", value: "test-lei-0001" }]
    });
    expect(matches[0]).toMatchObject({
      companyId: created.companyId,
      tier: "official_identifier",
      reviewRequired: false
    });
  });

  it("requires review for fuzzy-only identity matches", async () => {
    await registerCompany({
      legalName: "Northern Industrial Components",
      countryCode: "US"
    });
    const matches = await findCompanyMatches({
      legalName: "Northern Industrial Component Group",
      countryCode: "US"
    });
    expect(matches.some((match) => match.tier === "fuzzy_review" && match.reviewRequired)).toBe(true);
  });
});

describe("durable research campaign behavior", () => {
  it("reuses known companies, prevents concurrent duplicate claims, and reports saturation", async () => {
    const project = await repository.createProject({
      name: "Canonical registry verification",
      objective: "Find qualified companies without repeating research.",
      context: "",
      scope: "",
      constraints: [],
      budgetCents: 1000
    });
    const campaign = await createResearchCampaign({
      projectId: project.id,
      name: "Company coverage verification",
      targetCount: 3,
      existingCountPolicy: "ask"
    });
    const known = await registerCompany({
      legalName: "Coverage Registry Company",
      domain: "coverage-registry.example",
      countryCode: "US"
    });
    expect(known.companyId).toBeTruthy();

    const first = await addCampaignCandidate(campaign.id, {
      legalName: "Coverage Registry Co.",
      domain: "www.coverage-registry.example",
      countryCode: "US"
    });
    expect(first).toMatchObject({ resolution: "reusable", reused: true });

    const repeated = await addCampaignCandidate(campaign.id, {
      legalName: "Coverage Registry Company",
      domain: "https://coverage-registry.example/",
      countryCode: "US"
    });
    expect(repeated.candidateId).toBe(first.candidateId);

    const claim = await claimCandidate({
      campaignId: campaign.id,
      candidateId: first.candidateId,
      leaseSeconds: 300
    });
    expect(claim).toBeTruthy();
    expect(await claimCandidate({
      campaignId: campaign.id,
      candidateId: first.candidateId,
      leaseSeconds: 300
    })).toBeNull();
    expect(await releaseCandidateClaim(
      campaign.id,
      first.candidateId,
      claim!.leaseToken
    )).toBe(true);
    expect(await claimCandidate({
      campaignId: campaign.id,
      candidateId: first.candidateId,
      leaseSeconds: 300
    })).toBeTruthy();

    let coverage = await getCampaignCoverage(campaign.id);
    expect(coverage).toMatchObject({
      targetCount: 3,
      existingCountPolicy: "ask",
      eligible: 1,
      remaining: 2
    });

    await markCampaignSaturated(campaign.id, "No additional eligible companies found.");
    coverage = await getCampaignCoverage(campaign.id);
    expect(coverage).toMatchObject({
      saturated: true,
      saturationReason: "No additional eligible companies found."
    });
  });
});
