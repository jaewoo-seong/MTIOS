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
  return organizationProfileInput.parse({ companyName });
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
