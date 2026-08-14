import { and, count, countDistinct, desc, eq, ilike, inArray, isNotNull, max, or, type SQL } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/client";
import {
  canonicalCompanies,
  agentDefinitions,
  clientDatabases,
  clientRecords,
  companyProjectLinks,
  companySources,
  contextSources,
  documentRevisions,
  documents,
  organizations,
  projectResearchSettings,
  projects,
  projectStrategyVersions,
  researchEvidence,
  researchQueries,
  reportSources,
  reports
} from "@/lib/db/schema";
import type { ExternalMcpPrincipal } from "@/lib/mcp/external-credentials";
import { getApprovedOrganizationProfile, organizationProfileContext } from "@/lib/organization-profile";

type ReadToolName = "list_research_projects" | "get_research_project" | "get_project_briefing" | "search_business_os" | "get_company_research" | "get_document";

export class ExternalMcpAccessError extends Error {
  constructor(public code: "forbidden" | "not_found" | "invalid_arguments" | "invalid_cursor" | "idempotency_conflict" | "in_progress" | "rate_limited", message: string = code) {
    super(message);
  }
}

export async function executeExternalReadTool(principal: ExternalMcpPrincipal, name: ReadToolName, input: Record<string, unknown>) {
  if (name === "list_research_projects") return listProjects(principal, input);
  if (name === "get_research_project") return getProject(principal, input);
  if (name === "get_project_briefing") return getProjectBriefing(principal, input);
  if (name === "search_business_os") return searchBusinessOs(principal, input);
  if (name === "get_company_research") return getCompanyResearch(principal, input);
  return getDocument(principal, input);
}

async function getProjectBriefing(principal: ExternalMcpPrincipal, input: Record<string, unknown>) {
  requireScopes(principal, ["projects:read"]);
  const projectId = String(input.projectId);
  requireProject(principal, projectId);
  const db = requireDatabase();
  const [project] = await db.select().from(projects).where(and(
    eq(projects.id, projectId), eq(projects.organizationId, principal.organizationId)
  )).limit(1);
  if (!project) throw new ExternalMcpAccessError("not_found");
  const [organization, settings, agents, profile] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, principal.organizationId)).limit(1),
    db.select().from(projectResearchSettings).where(and(
      eq(projectResearchSettings.projectId, projectId), eq(projectResearchSettings.organizationId, principal.organizationId)
    )).limit(1),
    db.select().from(agentDefinitions).where(and(
      eq(agentDefinitions.organizationId, principal.organizationId), eq(agentDefinitions.active, true)
    )).orderBy(agentDefinitions.role, agentDefinitions.name),
    input.includeOrganizationContext === false || !principal.scopes.includes("organization:read")
      ? Promise.resolve(null)
      : getApprovedOrganizationProfile(principal.organizationId)
  ]);
  const activeStrategyId = settings[0]?.activeStrategyVersionId;
  const [strategy] = activeStrategyId
    ? await db.select().from(projectStrategyVersions).where(and(
      eq(projectStrategyVersions.id, activeStrategyId), eq(projectStrategyVersions.organizationId, principal.organizationId)
    )).limit(1)
    : await db.select().from(projectStrategyVersions).where(and(
      eq(projectStrategyVersions.projectId, projectId), eq(projectStrategyVersions.organizationId, principal.organizationId)
    )).orderBy(desc(projectStrategyVersions.version)).limit(1);
  const topic = typeof input.topic === "string" ? input.topic : "";
  const approvedContext = profile ? organizationProfileContext(profile) : [];
  return {
    organization: { id: principal.organizationId, name: profile?.companyName ?? organization[0]?.name ?? "MTI", approvedContext },
    externalAssistant: {
      role: "External collaborative reasoning and brainstorming partner for MTI Business OS.",
      expectations: [
        "Use the project objective, active strategy, approved MTI context, and constraints before proposing ideas.",
        "Separate sourced Business OS facts from assumptions, hypotheses, and creative suggestions.",
        "Return concrete ideas with rationale, expected value, evidence needed, risks, and a practical next step."
      ],
      limits: [
        "Do not claim to be an internal Business OS agent or imply that an idea has been approved.",
        "Do not start research, spend funds, change project state, or save ideas without a separate authorized tool call.",
        "Do not infer confidential MTI information that is absent from approved organization context."
      ]
    },
    project: {
      id: project.id, name: project.name, objective: project.objective, status: project.status,
      context: project.context.slice(0, 6000), scope: project.scope.slice(0, 3000), constraints: project.constraints,
      activeStrategy: strategy ? { id: strategy.id, version: strategy.version, title: strategy.title, summary: strategy.summary, ...strategy.strategy } : null,
      links: links("project", project.id)
    },
    businessOsAgents: agents.map((agent) => ({
      name: agent.name, role: agent.role, description: agent.description,
      capabilities: agent.capabilities, reviewRequired: agent.reviewRequired
    })),
    brainstorming: {
      topic,
      guidance: [
        "Generate multiple meaningfully different options rather than cosmetic variations.",
        "Challenge weak assumptions and identify what Business OS evidence would validate each idea.",
        "Tie recommendations to MTI value, the project objective, and an executable next action."
      ],
      suggestedEvaluationCriteria: ["strategic fit", "client value", "evidence strength", "feasibility", "cost and risk", "time to learning"]
    },
    warnings: approvedContext.length ? [] : [
      principal.scopes.includes("organization:read")
        ? "No approved MTI company-profile knowledge is available; do not invent company capabilities or positioning."
        : "This credential lacks organization:read; use project context only and do not infer broader MTI capabilities or positioning."
    ]
  };
}

async function listProjects(principal: ExternalMcpPrincipal, input: Record<string, unknown>) {
  requireScopes(principal, ["projects:read"]);
  const db = requireDatabase();
  const limit = Number(input.limit);
  const offset = decodeCursor(input.cursor);
  const conditions: SQL[] = [eq(projects.organizationId, principal.organizationId)];
  if (principal.accessMode === "selected_projects") {
    if (!principal.allowedProjectIds.length) return { projects: [], page: { nextCursor: null, hasMore: false } };
    conditions.push(inArray(projects.id, principal.allowedProjectIds));
  }
  if (typeof input.status === "string") conditions.push(eq(projects.status, input.status as "draft" | "active" | "paused" | "completed" | "archived"));
  if (typeof input.query === "string" && input.query) {
    const pattern = `%${escapeLike(input.query)}%`;
    conditions.push(or(ilike(projects.name, pattern), ilike(projects.objective, pattern))!);
  }
  const rows = await db.select().from(projects).where(and(...conditions)).orderBy(desc(projects.updatedAt), desc(projects.id)).limit(limit + 1).offset(offset);
  const pageRows = rows.slice(0, limit);
  const ids = pageRows.map((row) => row.id);
  const [settings, companies, dossiers] = ids.length ? await Promise.all([
    db.select().from(projectResearchSettings).where(inArray(projectResearchSettings.projectId, ids)),
    db.select({ projectId: companyProjectLinks.projectId, value: countDistinct(companyProjectLinks.companyId) }).from(companyProjectLinks)
      .where(inArray(companyProjectLinks.projectId, ids)).groupBy(companyProjectLinks.projectId),
    db.select({ projectId: clientDatabases.projectId, value: countDistinct(clientRecords.dossierDocumentId) })
      .from(clientRecords).innerJoin(clientDatabases, eq(clientDatabases.id, clientRecords.databaseId))
      .where(and(inArray(clientDatabases.projectId, ids), isNotNull(clientRecords.dossierDocumentId))).groupBy(clientDatabases.projectId)
  ]) : [[], [], []];
  return {
    projects: pageRows.map((project) => ({
      id: project.id,
      name: project.name,
      objective: project.objective,
      status: project.status,
      activeStrategyVersionId: settings.find((row) => row.projectId === project.id)?.activeStrategyVersionId ?? null,
      companyCount: Number(companies.find((row) => row.projectId === project.id)?.value ?? 0),
      dossierCount: Number(dossiers.find((row) => row.projectId === project.id)?.value ?? 0),
      lastActivityAt: project.updatedAt.toISOString(),
      links: links("project", project.id)
    })),
    page: { nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null, hasMore: rows.length > limit }
  };
}

async function getProject(principal: ExternalMcpPrincipal, input: Record<string, unknown>) {
  requireScopes(principal, ["projects:read"]);
  const projectId = String(input.projectId);
  requireProject(principal, projectId);
  const db = requireDatabase();
  const [project] = await db.select().from(projects).where(and(
    eq(projects.id, projectId), eq(projects.organizationId, principal.organizationId)
  )).limit(1);
  if (!project) throw new ExternalMcpAccessError("not_found");
  const include = new Set(input.include as string[]);
  const [settings] = await db.select().from(projectResearchSettings).where(and(
    eq(projectResearchSettings.projectId, projectId), eq(projectResearchSettings.organizationId, principal.organizationId)
  )).limit(1);
  const [strategy] = settings?.activeStrategyVersionId
    ? await db.select().from(projectStrategyVersions).where(and(
      eq(projectStrategyVersions.id, settings.activeStrategyVersionId), eq(projectStrategyVersions.organizationId, principal.organizationId)
    )).limit(1)
    : [];
  const [companyTotal, dossierTotal, documentTotal] = include.has("counts") ? await Promise.all([
    db.select({ value: countDistinct(companyProjectLinks.companyId) }).from(companyProjectLinks).where(and(eq(companyProjectLinks.projectId, projectId), eq(companyProjectLinks.organizationId, principal.organizationId))),
    db.select({ value: countDistinct(clientRecords.dossierDocumentId) }).from(clientRecords)
      .innerJoin(clientDatabases, eq(clientDatabases.id, clientRecords.databaseId)).where(and(
        eq(clientDatabases.projectId, projectId), eq(clientDatabases.organizationId, principal.organizationId), isNotNull(clientRecords.dossierDocumentId)
      )),
    db.select({ value: count() }).from(documents).where(and(eq(documents.projectId, projectId), eq(documents.organizationId, principal.organizationId)))
  ]) : [[], [], []];
  return { project: {
    id: project.id,
    name: project.name,
    objective: project.objective,
    status: project.status,
    strategy: include.has("strategy") && strategy ? { id: strategy.id, version: strategy.version, title: strategy.title, summary: strategy.summary, ...strategy.strategy } : null,
    counts: include.has("counts") ? {
      companies: Number(companyTotal[0]?.value ?? 0), dossiers: Number(dossierTotal[0]?.value ?? 0), documents: Number(documentTotal[0]?.value ?? 0)
    } : null,
    links: links("project", project.id)
  } };
}

async function searchBusinessOs(principal: ExternalMcpPrincipal, input: Record<string, unknown>) {
  requireScopes(principal, ["projects:read", "companies:read", "documents:read", "evidence:read"]);
  const db = requireDatabase();
  const requested = input.projectIds as string[];
  const projectIds = await resolveProjectIds(principal, requested);
  if (!projectIds.length) return { results: [], page: { nextCursor: null, hasMore: false } };
  const query = String(input.query);
  const pattern = `%${escapeLike(query)}%`;
  const kinds = new Set(input.kinds as string[]);
  const cap = Math.min(Number(input.limit) + decodeCursor(input.cursor) + 1, 101);
  const batches: Array<Promise<Array<Record<string, unknown>>>> = [];
  if (kinds.has("company")) batches.push(db.select({
    id: canonicalCompanies.id, title: canonicalCompanies.legalName, projectId: companyProjectLinks.projectId,
    confidence: canonicalCompanies.confidence, observedAt: canonicalCompanies.lastVerifiedAt
  }).from(canonicalCompanies).innerJoin(companyProjectLinks, eq(companyProjectLinks.companyId, canonicalCompanies.id)).where(and(
    eq(canonicalCompanies.organizationId, principal.organizationId), inArray(companyProjectLinks.projectId, projectIds),
    or(ilike(canonicalCompanies.legalName, pattern), ilike(canonicalCompanies.normalizedName, pattern))
  )).orderBy(desc(canonicalCompanies.updatedAt)).limit(cap).then((rows) => rows.map((row) => result({
    id: row.id, kind: "company", title: row.title, excerpt: row.title, projectId: row.projectId,
    companyId: row.id, documentId: null, observedAt: row.observedAt, confidence: normalizeConfidence(row.confidence)
  }))));
  for (const kind of ["dossier", "document"] as const) if (kinds.has(kind)) batches.push(db.select().from(documents).where(and(
    eq(documents.organizationId, principal.organizationId), inArray(documents.projectId, projectIds),
    kind === "dossier" ? eq(documents.aiGenerated, true) : eq(documents.aiGenerated, false),
    or(ilike(documents.title, pattern), ilike(documents.filename, pattern), ilike(documents.markdown, pattern))
  )).orderBy(desc(documents.updatedAt)).limit(cap).then((rows) => rows.map((row) => result({
    id: row.id, kind, title: row.title, excerpt: excerpt(row.markdown, query), projectId: row.projectId!, companyId: null,
    documentId: row.id, observedAt: row.updatedAt, confidence: null
  }))));
  if (kinds.has("evidence")) batches.push(db.select({ evidence: researchEvidence, projectId: researchQueries.projectId })
    .from(researchEvidence).innerJoin(researchQueries, eq(researchQueries.id, researchEvidence.queryId)).where(and(
      eq(researchEvidence.organizationId, principal.organizationId), inArray(researchQueries.projectId, projectIds),
      or(ilike(researchEvidence.title, pattern), ilike(researchEvidence.excerpt, pattern), ilike(researchEvidence.publisher, pattern))
    )).orderBy(desc(researchEvidence.retrievedAt)).limit(cap).then((rows) => rows.map(({ evidence, projectId }) => result({
      id: evidence.id, kind: "evidence", title: evidence.title, excerpt: excerpt(evidence.excerpt, query), projectId,
      companyId: null, documentId: null, observedAt: evidence.publishedAt ?? evidence.retrievedAt,
      confidence: normalizeConfidence(evidence.confidence), sourceUrl: evidence.url
    }))));
  const all = (await Promise.all(batches)).flat();
  const unique = [...new Map(all.map((item) => [`${item.kind}:${item.id}`, item])).values()];
  const offset = decodeCursor(input.cursor);
  const limit = Number(input.limit);
  const page = unique.slice(offset, offset + limit);
  return { results: page, page: { nextCursor: unique.length > offset + limit ? encodeCursor(offset + limit) : null, hasMore: unique.length > offset + limit } };
}

async function getCompanyResearch(principal: ExternalMcpPrincipal, input: Record<string, unknown>) {
  requireScopes(principal, ["companies:read"]);
  const db = requireDatabase();
  const companyId = String(input.companyId);
  const linkedProjects = await db.select({ projectId: companyProjectLinks.projectId }).from(companyProjectLinks).where(and(
    eq(companyProjectLinks.companyId, companyId), eq(companyProjectLinks.organizationId, principal.organizationId)
  ));
  const projectIds = linkedProjects.map((row) => row.projectId).filter((id) => canAccessProject(principal, id));
  if (!projectIds.length) throw new ExternalMcpAccessError("not_found");
  const [company] = await db.select().from(canonicalCompanies).where(and(
    eq(canonicalCompanies.id, companyId), eq(canonicalCompanies.organizationId, principal.organizationId)
  )).limit(1);
  if (!company) throw new ExternalMcpAccessError("not_found");
  const include = new Set(input.include as string[]);
  const records = include.has("record") ? await db.select({ record: clientRecords, projectId: clientDatabases.projectId })
    .from(clientRecords).innerJoin(clientDatabases, eq(clientDatabases.id, clientRecords.databaseId)).where(and(
      eq(clientRecords.companyId, companyId), inArray(clientDatabases.projectId, projectIds), eq(clientDatabases.organizationId, principal.organizationId)
    )).limit(1) : [];
  const dossierId = records[0]?.record.dossierDocumentId ?? null;
  const [dossier] = dossierId && principal.scopes.includes("documents:read")
    ? await db.select().from(documents).where(and(eq(documents.id, dossierId), inArray(documents.projectId, projectIds), eq(documents.organizationId, principal.organizationId))).limit(1)
    : [];
  const sources = include.has("evidence_summary") && principal.scopes.includes("evidence:read")
    ? await db.select({ id: companySources.id }).from(companySources).where(and(eq(companySources.companyId, companyId), eq(companySources.organizationId, principal.organizationId)))
    : [];
  const primaryDossier = dossier ? sourceRef({ id: dossier.id, kind: "dossier", title: dossier.title, projectId: dossier.projectId, companyId, documentId: dossier.id, observedAt: dossier.updatedAt, confidence: null }) : null;
  return {
    companyId,
    record: include.has("record") ? { ...company, projectId: projectIds[0], clientRecord: records[0]?.record ?? null } : null,
    primaryDossier: include.has("primary_dossier") ? primaryDossier : null,
    supportingDocuments: [],
    evidenceSummary: include.has("evidence_summary") ? { count: sources.length, gaps: sources.length ? [] : ["No canonical company evidence sources are linked."] } : null,
    warnings: [
      ...(!dossier && include.has("primary_dossier") ? ["No authorized primary dossier is published for this company."] : []),
      ...(include.has("primary_dossier") && !principal.scopes.includes("documents:read") ? ["The credential lacks documents:read."] : []),
      ...(include.has("evidence_summary") && !principal.scopes.includes("evidence:read") ? ["The credential lacks evidence:read."] : [])
    ]
  };
}

async function getDocument(principal: ExternalMcpPrincipal, input: Record<string, unknown>) {
  requireScopes(principal, ["documents:read"]);
  const db = requireDatabase();
  const documentId = String(input.documentId);
  const [document] = await db.select().from(documents).where(and(
    eq(documents.id, documentId), eq(documents.organizationId, principal.organizationId), isNotNull(documents.projectId)
  )).limit(1);
  if (!document?.projectId || !canAccessProject(principal, document.projectId)) throw new ExternalMcpAccessError("not_found");
  const [revision] = await db.select({ revision: max(documentRevisions.revision) }).from(documentRevisions).where(and(
    eq(documentRevisions.documentId, documentId), eq(documentRevisions.organizationId, principal.organizationId)
  ));
  const [latest] = revision?.revision ? await db.select().from(documentRevisions).where(and(
    eq(documentRevisions.documentId, documentId), eq(documentRevisions.revision, revision.revision), eq(documentRevisions.organizationId, principal.organizationId)
  )).limit(1) : [];
  const [sourceRows, reportRows] = await Promise.all([
    db.select().from(contextSources).where(and(
      eq(contextSources.organizationId, principal.organizationId), eq(contextSources.sourceId, documentId), eq(contextSources.projectId, document.projectId)
    )),
    db.select({ source: reportSources }).from(reportSources).innerJoin(reports, eq(reports.id, reportSources.reportId)).where(and(
      eq(reports.documentId, documentId),
      eq(reportSources.organizationId, principal.organizationId)
    ))
  ]);
  const markdown = latest?.markdown ?? document.markdown;
  const maxCharacters = Number(input.maxCharacters);
  const returned = markdown.slice(0, maxCharacters);
  return {
    documentId, title: document.title, markdown: returned, revision: latest?.revision ?? 1,
    approvalState: latest ? (latest.approved ? "approved" : "working") : "working",
    sources: [
      ...sourceRows.map((source) => sourceRef({
      id: source.id, kind: source.sourceType === "dossier" ? "dossier" : "document", title: source.title,
      projectId: source.projectId, companyId: null, documentId, observedAt: source.createdAt, confidence: null
      })),
      ...reportRows.map(({ source }) => sourceRef({
        id: source.documentRevisionId,
        kind: "document",
        title: source.title,
        projectId: source.projectId,
        companyId: null,
        documentId: source.documentId,
        observedAt: source.createdAt,
        confidence: null,
        sourceUrl: source.sourceUrl ?? undefined
      }))
    ],
    truncated: returned.length < markdown.length, returnedCharacters: returned.length, totalCharacters: markdown.length,
    links: links("document", documentId)
  };
}

async function resolveProjectIds(principal: ExternalMcpPrincipal, requested: string[]) {
  if (requested.some((id) => !canAccessProject(principal, id))) throw new ExternalMcpAccessError("forbidden");
  const db = requireDatabase();
  const conditions: SQL[] = [eq(projects.organizationId, principal.organizationId)];
  const ids = requested.length ? requested : principal.accessMode === "selected_projects" ? principal.allowedProjectIds : null;
  if (ids && !ids.length) return [];
  if (ids) conditions.push(inArray(projects.id, ids));
  return (await db.select({ id: projects.id }).from(projects).where(and(...conditions))).map((row) => row.id);
}

function requireScopes(principal: ExternalMcpPrincipal, scopes: ExternalMcpPrincipal["scopes"]) {
  if (scopes.some((scope) => !principal.scopes.includes(scope))) throw new ExternalMcpAccessError("forbidden");
}

function requireProject(principal: ExternalMcpPrincipal, projectId: string) {
  if (!canAccessProject(principal, projectId)) throw new ExternalMcpAccessError("not_found");
}

export function canAccessProject(principal: ExternalMcpPrincipal, projectId: string) {
  return principal.accessMode === "organization" || principal.allowedProjectIds.includes(projectId);
}

function encodeCursor(offset: number) { return Buffer.from(JSON.stringify({ v: 1, offset })).toString("base64url"); }
function decodeCursor(cursor: unknown) {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8")) as { v?: number; offset?: number };
    if (value.v !== 1 || !Number.isInteger(value.offset) || value.offset! < 0 || value.offset! > 100_000) throw new Error();
    return value.offset!;
  } catch { throw new ExternalMcpAccessError("invalid_cursor"); }
}

function escapeLike(value: string) { return value.replace(/[\\%_]/g, "\\$&"); }
function excerpt(text: string, query: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  const at = clean.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, (at < 0 ? 0 : at) - 300);
  return `${start ? "…" : ""}${clean.slice(start, start + 1200)}${clean.length > start + 1200 ? "…" : ""}`;
}
function normalizeConfidence(value: number | null) { return value === null ? null : Math.max(0, Math.min(1, value / 100)); }
function baseUrl() { return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""); }
function links(kind: "project" | "company" | "document" | "evidence", id: string) {
  if (kind === "project") return { web: `${baseUrl()}/?view=projects&project=${encodeURIComponent(id)}` };
  if (kind === "document") return { web: `${baseUrl()}/?view=documents&document=${encodeURIComponent(id)}` };
  return { web: `${baseUrl()}/?view=data&${kind}=${encodeURIComponent(id)}` };
}
type SourceInput = { id: string; kind: "project" | "company" | "dossier" | "document" | "evidence"; title: string; projectId: string | null; companyId: string | null; documentId: string | null; observedAt: Date | null; confidence: number | null; sourceUrl?: string; excerpt?: string };
function sourceRef(input: SourceInput) {
  return { sourceId: input.id, sourceKind: input.kind, projectId: input.projectId, companyId: input.companyId, documentId: input.documentId,
    title: input.title, url: input.sourceUrl ?? links(input.kind === "dossier" ? "document" : input.kind as "project" | "company" | "document" | "evidence", input.id).web,
    observedAt: input.observedAt?.toISOString() ?? null, confidence: input.confidence };
}
function result(input: Parameters<typeof sourceRef>[0]) {
  return { id: input.id, kind: input.kind, title: input.title, excerpt: input.excerpt ?? input.title,
    reference: sourceRef(input), links: links(input.kind === "dossier" ? "document" : input.kind as "company" | "document" | "evidence", input.id) };
}
