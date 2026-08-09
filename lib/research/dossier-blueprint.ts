export type DossierResearchSection = {
  section: string;
  purpose: string;
  evidenceNeeded: string[];
  priority: "required" | "supporting";
};

export const defaultDossierResearchPlan: DossierResearchSection[] = [
  {
    section: "Executive decision summary",
    purpose: "Give the operator the few facts that determine whether this company deserves pursuit.",
    evidenceNeeded: ["qualification conclusion", "strongest current signals", "major evidence gaps"],
    priority: "required"
  },
  {
    section: "Company identity and relevant operating profile",
    purpose: "Verify the entity and describe only the operations, markets, and locations relevant to this project.",
    evidenceNeeded: ["legal and operating identity", "official website", "relevant locations", "relevant products or business lines"],
    priority: "required"
  },
  {
    section: "Current change and buying signals",
    purpose: "Identify recent events that could create an immediate need for outside support.",
    evidenceNeeded: ["expansion or investment", "hiring or organization change", "market entry or transformation", "dated source evidence"],
    priority: "required"
  },
  {
    section: "Decision-makers and buying context",
    purpose: "Identify the people or functions likely to own the problem, budget, or introduction.",
    evidenceNeeded: ["relevant leaders", "role relevance", "public professional source", "likely buying function"],
    priority: "required"
  },
  {
    section: "Priority contacts and verified outreach routes",
    purpose: "Give the operator the strongest lawful, publicly available path to reach the relevant buyer, sponsor, or company function.",
    evidenceNeeded: ["person name", "current title and role relevance", "public professional-profile hyperlink", "publicly published work email when available", "business phone or general company email", "official contact-form hyperlink", "source and last-verified date"],
    priority: "required"
  },
  {
    section: "Why this company may need MTI services",
    purpose: "Connect verified company conditions to specific MTI capabilities without presenting a sales hypothesis as fact.",
    evidenceNeeded: ["observed business need", "supporting evidence", "matched MTI service", "expected business value", "confidence and assumptions"],
    priority: "required"
  },
  {
    section: "Path to becoming an MTI client",
    purpose: "Turn the evidence into a practical, company-specific engagement path.",
    evidenceNeeded: ["best entry point", "recommended first offer", "buyer or sponsor", "timing trigger", "next action", "likely objection"],
    priority: "required"
  },
  {
    section: "Risks, disqualifiers, and evidence gaps",
    purpose: "Make weak evidence, conflicts, and reasons not to pursue visible before approval.",
    evidenceNeeded: ["disqualifiers", "conflicting evidence", "unknowns", "recommended verification"],
    priority: "required"
  },
  {
    section: "Source index",
    purpose: "Preserve a reviewable trail for every material claim.",
    evidenceNeeded: ["source title", "URL", "publisher", "publication or retrieval date", "claim supported"],
    priority: "required"
  }
];

export const defaultDossierInformationExclusions = [
  "Generic company history that does not affect qualification, need, timing, or outreach",
  "Private or inferred personal contact details; include only publicly published professional or business contact information",
  "Long product catalogs without a direct connection to the research strategy",
  "Repeated facts that do not add new evidence or decision value"
];

/** Upper bound on the template embedded in every dossier worker prompt. */
export const dossierTemplateLimit = 6000;

export function buildDossierTemplate(input: {
  dossierResearchPlan?: DossierResearchSection[];
  informationExclusions?: string[];
  evidenceStandard?: string;
}) {
  const proposedPlan = input.dossierResearchPlan?.length ? input.dossierResearchPlan : defaultDossierResearchPlan;
  const contactSection = defaultDossierResearchPlan.find((item) => item.section === "Priority contacts and verified outreach routes")!;
  // Older approved strategies already contain a frozen blueprint. Contact
  // research is a product-level dossier invariant, so add it without forcing
  // the operator to recreate every active strategy version.
  const hasContactSection = proposedPlan.some((item) => /contact|outreach route/i.test(item.section));
  const decisionMakerIndex = proposedPlan.findIndex((item) => /decision.?maker|buying context/i.test(item.section));
  const plan = hasContactSection
    ? proposedPlan
    : [
        ...proposedPlan.slice(0, decisionMakerIndex >= 0 ? decisionMakerIndex + 1 : 0),
        contactSection,
        ...proposedPlan.slice(decisionMakerIndex >= 0 ? decisionMakerIndex + 1 : 0)
      ];
  const exclusions = input.informationExclusions?.length ? input.informationExclusions : defaultDossierInformationExclusions;

  const head = [
    "# Company master dossier",
    "",
    "Research only decision-useful information defined below. Keep facts, inference, sales hypotheses, and unknowns visibly separate."
  ].join("\n");
  // The exclusions, the evidence standard, and the citation format are the
  // dossier's contract with the operator. They are assembled first and always
  // emitted, so a long blueprint can never truncate them away.
  const tail = [
    "",
    "## Information intentionally excluded",
    ...exclusions.map((item) => `- ${item}`),
    "",
    `Evidence standard: ${clamp(input.evidenceStandard ?? "Cite every material claim with a descriptive Markdown hyperlink and date.", 600)}`,
    "Citation format: use readable inline Markdown links such as [OpenDART filing](https://example.com), never a bare full URL. Every material factual claim must have an adjacent citation, and every source-index entry must be a hyperlink."
  ].join("\n");

  // Sections then fill whatever budget is left, whole blocks at a time. A
  // section is either fully present or absent; none is ever cut mid-sentence.
  const budget = Math.max(0, dossierTemplateLimit - head.length - tail.length);
  const sections: string[] = [];
  let used = 0;
  for (const item of plan) {
    const block = [
      "",
      `## ${item.section}`,
      `Purpose: ${clamp(item.purpose, 400)}`,
      `Required evidence: ${clamp(item.evidenceNeeded.join("; "), 400)}.`
    ].join("\n");
    if (used + block.length > budget) break;
    sections.push(block);
    used += block.length;
  }
  return [head, ...sections, tail].join("\n");
}

function clamp(value: string, length: number) {
  const trimmed = value.trim();
  return trimmed.length <= length ? trimmed : `${trimmed.slice(0, length).trimEnd()}…`;
}
