import { describe, expect, it } from "vitest";
import {
  buildDossierTemplate,
  defaultDossierResearchPlan,
  dossierTemplateLimit,
  type DossierResearchSection
} from "@/lib/research/dossier-blueprint";

/** The largest blueprint the strategy schema permits. */
function maximumPlan(): DossierResearchSection[] {
  return Array.from({ length: 16 }, (_item, index) => ({
    section: `Section ${index + 1} with a realistically descriptive operator-facing name`,
    purpose: "A realistic one-sentence purpose describing exactly what this section must establish before an operator can decide whether to pursue the company.",
    evidenceNeeded: ["evidence item one", "evidence item two", "evidence item three", "evidence item four", "evidence item five"],
    priority: "required" as const
  }));
}

describe("dossier blueprint invariants", () => {
  it("adds contact research and linked citations to older frozen strategies", () => {
    const template = buildDossierTemplate({
      dossierResearchPlan: [{
        section: "Decision-makers and buying context",
        purpose: "Find the buyer.",
        evidenceNeeded: ["name and title"],
        priority: "required"
      }]
    });

    expect(template).toContain("## Priority contacts and verified outreach routes");
    expect(template).toContain("publicly published work email when available");
    expect(template).toContain("descriptive Markdown hyperlink");
    expect(template).toContain("never a bare full URL");
  });

  it("keeps the citation contract even at the largest permitted blueprint", () => {
    // A 16-section plan used to overflow a flat 4000-character cap, silently
    // cutting the exclusions, the evidence standard, and the citation rules
    // off the end of the template.
    const template = buildDossierTemplate({
      dossierResearchPlan: maximumPlan(),
      evidenceStandard: "Cite everything."
    });

    expect(template.length).toBeLessThanOrEqual(dossierTemplateLimit);
    expect(template).toContain("## Information intentionally excluded");
    expect(template).toContain("Evidence standard: Cite everything.");
    expect(template).toContain("Citation format:");
    expect(template).toContain("never a bare full URL");
  });

  it("never cuts a section mid-sentence when trimming to fit", () => {
    const template = buildDossierTemplate({
      dossierResearchPlan: maximumPlan().map((section) => ({
        ...section,
        purpose: "x".repeat(900),
        evidenceNeeded: [("y".repeat(400))]
      }))
    });

    expect(template.length).toBeLessThanOrEqual(dossierTemplateLimit);
    expect(template).toContain("Citation format:");
    // Every emitted section heading has its purpose and evidence lines intact.
    const headings = template.match(/^## .+$/gm) ?? [];
    const bodyHeadings = headings.filter((heading) => heading !== "## Information intentionally excluded");
    expect(bodyHeadings.length).toBeGreaterThan(0);
    expect(template.match(/^Purpose: /gm)?.length).toBe(bodyHeadings.length);
    expect(template.match(/^Required evidence: /gm)?.length).toBe(bodyHeadings.length);
  });

  it("fits the default blueprint without dropping any section", () => {
    const template = buildDossierTemplate({ dossierResearchPlan: defaultDossierResearchPlan });
    for (const section of defaultDossierResearchPlan) {
      expect(template).toContain(`## ${section.section}`);
    }
  });
});
