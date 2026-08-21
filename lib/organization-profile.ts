import { and, desc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDatabase } from "@/lib/db/client";
import { organizationProfileVersions } from "@/lib/db/schema";

const list = z.array(z.string().trim().min(1).max(500)).max(50);

export const organizationProfileInput = z.object({
  companyName: z.string().trim().min(1).max(180),
  description: z.string().trim().max(8000).default(""),
  services: list.default([]),
  industries: list.default([]),
  geographies: list.default([]),
  idealClients: list.default([]),
  clientProblems: list.default([]),
  valuePropositions: list.default([]),
  differentiators: list.default([]),
  engagementModels: list.default([]),
  qualificationCriteria: list.default([]),
  exclusions: list.default([]),
  terminology: z.record(z.string().trim().min(1).max(100), z.string().trim().max(500)).default({}),
  publicContacts: z.array(z.object({
    label: z.string().trim().min(1).max(100),
    value: z.string().trim().min(1).max(500)
  })).max(20).default([]),
  forbiddenClaims: list.default([]),
  sourceUrls: z.array(z.string().url().max(2000)).max(50).default([])
}).strict();

export type OrganizationProfileInput = z.infer<typeof organizationProfileInput>;
export type OrganizationProfileVersion = typeof organizationProfileVersions.$inferSelect;

/** Conservative facts already established throughout MTI Business OS. */
export const MTI_DEFAULT_ORGANIZATION_PROFILE: OrganizationProfileInput = organizationProfileInput.parse({
  companyName: "MTI Korea",
  description: "MTI Korea provides evidence-led market, company, workforce, location, partner, and commercial intelligence for organizations evaluating opportunities in South Korea. Its work turns bilingual research into decision-ready recommendations, target-company dossiers, and practical market-entry or business-development next steps.",
  services: [
    "South Korea market research and market validation",
    "Market-entry strategy and operating-location analysis",
    "Partner, supplier, customer, and target-company identification",
    "Company intelligence and evidence-backed due diligence",
    "Workforce, hiring, and labor-market intelligence",
    "Bilingual English-Korean commercial intelligence",
    "Business-development opportunity analysis and outreach planning"
  ],
  industries: ["Advanced manufacturing", "Industrial automation and robotics", "Technology and supply-chain businesses"],
  geographies: ["South Korea", "International organizations evaluating the South Korean market"],
  idealClients: [
    "Companies evaluating entry, expansion, partnerships, customers, suppliers, or operating locations in South Korea",
    "Organizations that need verified Korean company, market, or workforce intelligence",
    "Business-development teams seeking evidence-backed Korean prospects and actionable next steps"
  ],
  clientProblems: [
    "Insufficient reliable English-language information about Korean markets and companies",
    "Difficulty identifying and qualifying credible Korean companies, partners, suppliers, or customers",
    "Uncertainty about market demand, expansion signals, workforce conditions, locations, and entry options",
    "Fragmented evidence that has not been converted into a decision or practical next action"
  ],
  valuePropositions: [
    "Decision-ready intelligence grounded in cited Korean and English evidence",
    "Clear separation of verified facts, inference, unknowns, and sales hypotheses",
    "Research connected to a concrete market-entry, partnership, location, or business-development decision",
    "Actionable company dossiers that identify likely buyers, triggers, entry points, and next steps"
  ],
  differentiators: [
    "Bilingual Korean and English research",
    "Korea-specific company, public-data, market, and workforce evidence",
    "Evidence-first qualification with adjacent source citations",
    "Continuous research workflows that preserve strategy and source provenance"
  ],
  engagementModels: [
    "Focused market or company research project",
    "Target-company discovery and qualification program",
    "Decision-ready company dossier and opportunity assessment",
    "Ongoing research and intelligence support"
  ],
  qualificationCriteria: [
    "The requested decision or business objective is explicit",
    "The scope has a meaningful connection to South Korea",
    "Credible public or client-approved evidence can materially improve the decision",
    "The work fits MTI market, company, workforce, location, partner, or commercial-intelligence capabilities"
  ],
  exclusions: [
    "Legal, tax, investment, or regulatory advice presented as professional advice",
    "Unsupported claims, invented contacts, inferred private email addresses, or private personal data",
    "Research with no defined business decision, qualification standard, or actionable use"
  ],
  terminology: {
    "MTI": "MTI Korea",
    "Dossier": "A cited, decision-ready company intelligence document",
    "Qualified company": "A company that meets the approved project strategy using recorded evidence"
  },
  forbiddenClaims: [
    "Do not claim a fact, client relationship, proprietary data source, service outcome, credential, office, or capability that is not present in approved context or cited evidence.",
    "Do not present inference, forecasts, or sales hypotheses as verified fact.",
    "Do not describe MTI as providing legal, tax, investment, or regulatory advice."
  ]
});

export async function listOrganizationProfileVersions(organizationId: string) {
  const db = requireDatabase();
  const versions = await db.select().from(organizationProfileVersions).where(
    eq(organizationProfileVersions.organizationId, organizationId)
  ).orderBy(desc(organizationProfileVersions.revision));
  return {
    active: versions.find((version) => version.status === "approved") ?? null,
    draft: versions.find((version) => version.status === "draft") ?? null,
    versions
  };
}

export async function getApprovedOrganizationProfile(organizationId: string) {
  const db = requireDatabase();
  const [profile] = await db.select().from(organizationProfileVersions).where(and(
    eq(organizationProfileVersions.organizationId, organizationId),
    eq(organizationProfileVersions.status, "approved")
  )).orderBy(desc(organizationProfileVersions.revision)).limit(1);
  return profile ?? null;
}

export async function createOrganizationProfileDraft(
  organizationId: string,
  actorId: string,
  fallbackCompanyName: string
) {
  const db = requireDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`organization-profile:${organizationId}`}))`);
    const [existing] = await tx.select().from(organizationProfileVersions).where(and(
      eq(organizationProfileVersions.organizationId, organizationId),
      eq(organizationProfileVersions.status, "draft")
    )).orderBy(desc(organizationProfileVersions.revision)).limit(1);
    if (existing) return existing;
    const [latest] = await tx.select().from(organizationProfileVersions).where(
      eq(organizationProfileVersions.organizationId, organizationId)
    ).orderBy(desc(organizationProfileVersions.revision)).limit(1);
    const [revisionRow] = await tx.select({ value: max(organizationProfileVersions.revision) })
      .from(organizationProfileVersions).where(eq(organizationProfileVersions.organizationId, organizationId));
    const content = latest ? profileContent(latest) : emptyProfile(fallbackCompanyName);
    const [created] = await tx.insert(organizationProfileVersions).values({
      organizationId,
      revision: Number(revisionRow?.value ?? 0) + 1,
      status: "draft",
      createdBy: actorId,
      ...content
    }).returning();
    return created;
  });
}

export async function updateOrganizationProfileDraft(
  organizationId: string,
  profileId: string,
  input: OrganizationProfileInput
) {
  const db = requireDatabase();
  const [updated] = await db.update(organizationProfileVersions).set({
    ...input,
    updatedAt: new Date()
  }).where(and(
    eq(organizationProfileVersions.id, profileId),
    eq(organizationProfileVersions.organizationId, organizationId),
    eq(organizationProfileVersions.status, "draft")
  )).returning();
  return updated ?? null;
}

export async function approveOrganizationProfileDraft(
  organizationId: string,
  profileId: string,
  actorId: string
) {
  const db = requireDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`organization-profile:${organizationId}`}))`);
    const [draft] = await tx.select().from(organizationProfileVersions).where(and(
      eq(organizationProfileVersions.id, profileId),
      eq(organizationProfileVersions.organizationId, organizationId),
      eq(organizationProfileVersions.status, "draft")
    )).limit(1);
    if (!draft) return null;
    const now = new Date();
    await tx.update(organizationProfileVersions).set({ status: "superseded", updatedAt: now }).where(and(
      eq(organizationProfileVersions.organizationId, organizationId),
      eq(organizationProfileVersions.status, "approved")
    ));
    const [approved] = await tx.update(organizationProfileVersions).set({
      status: "approved", approvedBy: actorId, approvedAt: now, updatedAt: now
    }).where(eq(organizationProfileVersions.id, draft.id)).returning();
    return approved;
  });
}

export function organizationProfileContext(profile: OrganizationProfileVersion) {
  const sections: Array<{ title: string; content: string }> = [];
  const add = (title: string, values: string[]) => {
    if (values.length) sections.push({ title, content: values.map((value) => `- ${value}`).join("\n") });
  };
  if (profile.description) sections.push({ title: "Company description", content: profile.description });
  add("Forbidden claims", profile.forbiddenClaims);
  add("Exclusions", profile.exclusions);
  add("Services", profile.services);
  addGrouped(sections, "Markets", [["Industries", profile.industries], ["Geographies", profile.geographies]]);
  addGrouped(sections, "Clients", [["Ideal clients", profile.idealClients], ["Problems served", profile.clientProblems]]);
  addGrouped(sections, "Positioning", [["Value propositions", profile.valuePropositions], ["Differentiators", profile.differentiators]]);
  addGrouped(sections, "Delivery and qualification", [["Engagement models", profile.engagementModels], ["Qualification criteria", profile.qualificationCriteria]]);
  if (Object.keys(profile.terminology).length) sections.push({
    title: "Terminology",
    content: Object.entries(profile.terminology).map(([term, meaning]) => `- ${term}: ${meaning}`).join("\n")
  });
  addGrouped(sections, "Public references", [
    ["Contacts", profile.publicContacts.map((item) => `${item.label}: ${item.value}`)],
    ["Sources", profile.sourceUrls]
  ]);
  return sections.slice(0, 10).map((section) => ({ ...section, content: section.content.slice(0, 4000) }));
}

function addGrouped(
  sections: Array<{ title: string; content: string }>,
  title: string,
  groups: Array<[string, string[]]>
) {
  const content = groups.filter(([, values]) => values.length).map(([label, values]) =>
    `${label}:\n${values.map((value) => `- ${value}`).join("\n")}`
  ).join("\n");
  if (content) sections.push({ title, content });
}

function emptyProfile(companyName: string): OrganizationProfileInput {
  return companyName.trim().toLowerCase() === "mti korea"
    ? MTI_DEFAULT_ORGANIZATION_PROFILE
    : organizationProfileInput.parse({ companyName });
}

function profileContent(profile: OrganizationProfileVersion): OrganizationProfileInput {
  return organizationProfileInput.parse({
    companyName: profile.companyName,
    description: profile.description,
    services: profile.services,
    industries: profile.industries,
    geographies: profile.geographies,
    idealClients: profile.idealClients,
    clientProblems: profile.clientProblems,
    valuePropositions: profile.valuePropositions,
    differentiators: profile.differentiators,
    engagementModels: profile.engagementModels,
    qualificationCriteria: profile.qualificationCriteria,
    exclusions: profile.exclusions,
    terminology: profile.terminology,
    publicContacts: profile.publicContacts,
    forbiddenClaims: profile.forbiddenClaims,
    sourceUrls: profile.sourceUrls
  });
}
