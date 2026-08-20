import { and, desc, eq, inArray } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/client";
import {
  mcpExternalCredentialProjects,
  mcpExternalInvocations,
  mcpProjectOrigins,
  clientDatabases,
  clientRecords,
  documentRevisions,
  documentFolders,
  documents,
  projects,
  projectStrategyVersions,
  reportProjects,
  reportSources,
  reports
} from "@/lib/db/schema";
import type { ExternalMcpPrincipal } from "@/lib/mcp/external-credentials";
import { requestHash } from "@/lib/mcp/external-credentials";
import { canAccessProject, ExternalMcpAccessError } from "@/lib/mcp/external-read";
import { repository } from "@/lib/repository";
import { activateResearchStrategy, proposeResearchStrategy } from "@/lib/research-workspace";
import { dispatchNotificationDelivery, dispatchResearchDiscovery, dispatchResearchProject } from "@/lib/workflows/trigger";
import { queueReportReadyNotification } from "@/lib/notifications";
import { reportError } from "@/lib/observability/logger";

type WriteToolName = "draft_research_project" | "activate_research_project" | "create_cross_project_report";

export async function executeExternalWriteTool(
  principal: ExternalMcpPrincipal,
  invocationId: string,
  name: WriteToolName,
  input: Record<string, unknown>
) {
  if (name === "draft_research_project") return draftResearchProject(principal, invocationId, input);
  if (name === "activate_research_project") return activateResearchProject(principal, input);
  return createCrossProjectReport(principal, invocationId, input);
}

async function createCrossProjectReport(
  principal: ExternalMcpPrincipal,
  invocationId: string,
  input: Record<string, unknown>
) {
  if (!principal.scopes.includes("reports:create")) throw new ExternalMcpAccessError("forbidden");
  rejectSecretLikeContent([
    String(input.title),
    String(input.objective),
    ...(input.sections as string[])
  ].join("\n"));
  const requestedIds = [...new Set(input.projectIds as string[])];
  if (requestedIds.some((projectId) => !canAccessProject(principal, projectId))) {
    throw new ExternalMcpAccessError("not_found");
  }
  const db = requireDatabase();
  const authorizedProjects = await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(
    eq(projects.organizationId, principal.organizationId),
    inArray(projects.id, requestedIds)
  ));
  if (authorizedProjects.length !== requestedIds.length) throw new ExternalMcpAccessError("not_found");

  const requestedDocuments = input.sourceDocumentIds as string[];
  if (new Set(requestedDocuments).size > Number(input.maxSources)) {
    throw new ExternalMcpAccessError("invalid_arguments", "maxSources must cover every explicitly selected document.");
  }
  const dossierDocumentIds = String(input.evidencePolicy) === "approved_dossiers_only"
    ? (await db.select({ id: clientRecords.dossierDocumentId }).from(clientRecords)
      .innerJoin(clientDatabases, eq(clientDatabases.id, clientRecords.databaseId))
      .where(and(
        eq(clientDatabases.organizationId, principal.organizationId),
        inArray(clientDatabases.projectId, requestedIds)
      ))).map((row) => row.id).filter((id): id is string => Boolean(id))
    : null;
  const documentConditions = [
    eq(documents.organizationId, principal.organizationId),
    inArray(documents.projectId, requestedIds)
  ];
  if (dossierDocumentIds?.length) documentConditions.push(inArray(documents.id, dossierDocumentIds));
  if (requestedDocuments.length) documentConditions.push(inArray(documents.id, requestedDocuments));
  const rows = dossierDocumentIds && !dossierDocumentIds.length ? [] : await db.select({ document: documents, revision: documentRevisions })
    .from(documentRevisions)
    .innerJoin(documents, eq(documents.id, documentRevisions.documentId))
    .where(and(...documentConditions, eq(documentRevisions.approved, true)))
    .orderBy(desc(documentRevisions.revision), desc(documents.updatedAt));
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) if (!latest.has(row.document.id)) latest.set(row.document.id, row);
  if (requestedDocuments.length && latest.size !== new Set(requestedDocuments).size) {
    throw new ExternalMcpAccessError("not_found", "One or more selected documents are unavailable or lack an approved revision.");
  }
  const sourceBudget = Number(input.maxSourceCharacters);
  let remaining = sourceBudget;
  const selected = [...latest.values()].slice(0, Number(input.maxSources)).map((row, index) => {
    const markdown = row.revision.markdown.slice(0, Math.min(12000, Math.max(0, remaining)));
    remaining -= markdown.length;
    return {
      ...row,
      citationKey: `S${index + 1}`,
      markdown,
      sourceUrl: reportDocumentLink(row.document.id)
    };
  }).filter((source) => source.markdown.length > 0);
  const representedProjects = new Set(selected.map((source) => source.document.projectId).filter(Boolean));
  const content = buildCrossProjectReportContent({
    title: String(input.title),
    objective: String(input.objective),
    sections: input.sections as string[],
    projects: authorizedProjects,
    sources: selected
  });
  const reportId = invocationId;
  await db.transaction(async (tx) => {
    const [folder] = await tx.insert(documentFolders).values({
      organizationId: principal.organizationId,
      name: "Reports",
      system: true,
      position: 3
    }).onConflictDoUpdate({
      target: [documentFolders.organizationId, documentFolders.name],
      set: { updatedAt: new Date() }
    }).returning({ id: documentFolders.id });
    await tx.insert(documents).values({
      id: reportId,
      organizationId: principal.organizationId,
      folderId: folder.id,
      projectId: requestedIds[0],
      title: String(input.title),
      filename: `${safeFilename(String(input.title))}.md`,
      mimeType: "text/markdown",
      sourceKind: "markdown",
      aiGenerated: true,
      sizeBytes: Buffer.byteLength(content),
      wordCount: (content.match(/\S+/g) ?? []).length,
      markdown: content,
      createdBy: principal.createdByUserId
    }).onConflictDoUpdate({
      target: documents.id,
      set: { title: String(input.title), markdown: content, sizeBytes: Buffer.byteLength(content), updatedAt: new Date() }
    });
    await tx.insert(documentRevisions).values({
      id: reportId,
      organizationId: principal.organizationId,
      documentId: reportId,
      revision: 1,
      markdown: content,
      contentHash: requestHash(content),
      source: "external_mcp_cross_project_report",
      changeSummary: "Created from approved Business OS source revisions.",
      createdBy: principal.createdByUserId,
      approved: false
    }).onConflictDoUpdate({
      target: [documentRevisions.documentId, documentRevisions.revision],
      set: { markdown: content, contentHash: requestHash(content) }
    });
    await tx.insert(reports).values({
      id: reportId,
      organizationId: principal.organizationId,
      projectId: requestedIds.length === 1 ? requestedIds[0] : null,
      documentId: reportId,
      title: String(input.title),
      summary: String(input.objective),
      content,
      status: "review",
      createdBy: principal.createdByUserId
    }).onConflictDoUpdate({ target: reports.id, set: { content, updatedAt: new Date() } });
    await tx.insert(reportProjects).values(requestedIds.map((projectId) => ({
      reportId, projectId, organizationId: principal.organizationId
    }))).onConflictDoNothing({ target: [reportProjects.reportId, reportProjects.projectId] });
    if (selected.length) await tx.insert(reportSources).values(selected.map((source) => ({
      organizationId: principal.organizationId,
      reportId,
      projectId: source.document.projectId!,
      documentId: source.document.id,
      documentRevisionId: source.revision.id,
      citationKey: source.citationKey,
      title: source.document.title,
      sourceUrl: source.sourceUrl,
      includedCharacters: source.markdown.length
    }))).onConflictDoNothing({ target: [reportSources.reportId, reportSources.documentRevisionId] });
  });
  try {
    const notification = await queueReportReadyNotification(reportId);
    if (notification.queued) await dispatchNotificationDelivery(notification.id);
  } catch (error) {
    reportError("notification.dispatch_failed", error, { reportId, invocationId });
  }
  return {
    reportDocumentId: reportId,
    status: "ready" as const,
    sourceCoverage: {
      requestedProjectCount: requestedIds.length,
      includedProjectCount: representedProjects.size,
      sourceCount: selected.length
    },
    links: reportLinks(reportId)
  };
}

async function draftResearchProject(principal: ExternalMcpPrincipal, invocationId: string, input: Record<string, unknown>) {
  if (!principal.scopes.includes("projects:draft")) throw new ExternalMcpAccessError("forbidden");
  const conversationSummary = String(input.conversationSummary ?? "");
  rejectSecretLikeContent([
    input.title, input.objective, conversationSummary,
    ...(input.geographyHints as string[]), ...(input.industryHints as string[]), ...(input.researchQuestions as string[])
  ].map(String).join("\n"));
  const db = requireDatabase();
  const [invocation] = await db.select({ projectId: mcpExternalInvocations.projectId }).from(mcpExternalInvocations).where(and(
    eq(mcpExternalInvocations.id, invocationId), eq(mcpExternalInvocations.credentialId, principal.credentialId)
  )).limit(1);
  const projectId = invocation?.projectId ?? invocationId;
  const [existingProject] = await db.select({ id: projects.id }).from(projects).where(and(
    eq(projects.id, projectId), eq(projects.organizationId, principal.organizationId)
  )).limit(1);
  if (!existingProject) {
    const scope = [
      ...(input.geographyHints as string[]).map((value) => `Geography: ${value}`),
      ...(input.industryHints as string[]).map((value) => `Industry: ${value}`),
      ...(input.researchQuestions as string[]).map((value) => `Question: ${value}`)
    ].join("\n");
    await repository.createProject({
      name: String(input.title),
      objective: String(input.objective),
      context: conversationSummary,
      scope,
      constraints: [],
      budgetCents: null,
      status: "draft",
      reviewGates: ["Explicit approval is required before external research activation."],
      outputRequirements: ["Every material research claim must include an adjacent citation."]
    }, principal.createdByUserId, principal.organizationId, projectId);
  }
  await db.update(mcpExternalInvocations).set({ projectId, updatedAt: new Date() }).where(eq(mcpExternalInvocations.id, invocationId));
  await db.insert(mcpProjectOrigins).values({
    organizationId: principal.organizationId,
    projectId,
    credentialId: principal.credentialId,
    invocationId,
    externalClientName: principal.clientName,
    conversationSummary
  }).onConflictDoNothing({ target: mcpProjectOrigins.projectId });
  if (principal.accessMode === "selected_projects") {
    await db.insert(mcpExternalCredentialProjects).values({ credentialId: principal.credentialId, projectId })
      .onConflictDoNothing({ target: [mcpExternalCredentialProjects.credentialId, mcpExternalCredentialProjects.projectId] });
    if (!principal.allowedProjectIds.includes(projectId)) principal.allowedProjectIds.push(projectId);
  }
  const [existingStrategy] = await db.select().from(projectStrategyVersions).where(and(
    eq(projectStrategyVersions.projectId, projectId), eq(projectStrategyVersions.organizationId, principal.organizationId),
    eq(projectStrategyVersions.status, "proposed")
  )).orderBy(desc(projectStrategyVersions.version)).limit(1);
  const proposal = existingStrategy ? { version: existingStrategy } : await proposeResearchStrategy({
    projectId,
    userId: principal.createdByUserId,
    organizationId: principal.organizationId,
    instruction: buildStrategyInstruction(input)
  });
  const version = proposal.version;
  return {
    projectId,
    strategyVersionId: version.id,
    status: "draft" as const,
    proposal: { title: version.title, summary: version.summary, ...version.strategy },
    warnings: conversationSummary ? [] : ["No conversation summary was supplied; the strategy uses only the explicit project fields."],
    clarificationQuestions: [],
    requiresApproval: true as const,
    links: projectLinks(projectId)
  };
}

async function activateResearchProject(principal: ExternalMcpPrincipal, input: Record<string, unknown>) {
  if (!principal.scopes.includes("research:execute")) throw new ExternalMcpAccessError("forbidden");
  const projectId = String(input.projectId);
  if (!canAccessProject(principal, projectId)) throw new ExternalMcpAccessError("not_found");
  const db = requireDatabase();
  const [project] = await db.select({ id: projects.id }).from(projects).where(and(
    eq(projects.id, projectId), eq(projects.organizationId, principal.organizationId)
  )).limit(1);
  if (!project) throw new ExternalMcpAccessError("not_found");
  const strategyVersionId = String(input.strategyVersionId);
  const strategy = await activateResearchStrategy(projectId, strategyVersionId, principal.createdByUserId, principal.organizationId);
  if (!strategy) throw new ExternalMcpAccessError("not_found");
  const stableKey = `external-mcp:${requestHash({ credentialId: principal.credentialId, idempotencyKey: input.idempotencyKey }).slice(0, 40)}`;
  const [discovery, dossiers] = await Promise.all([
    dispatchResearchDiscovery(projectId, `${stableKey}:discovery`),
    dispatchResearchProject(projectId, `${stableKey}:dossiers`)
  ]);
  return {
    projectId,
    strategyVersionId,
    status: discovery.mode === "managed" || dossiers.mode === "managed" ? "queued" as const : "active" as const,
    runId: null,
    links: projectLinks(projectId)
  };
}

function buildStrategyInstruction(input: Record<string, unknown>) {
  return [
    `Create a complete proposed research strategy for: ${String(input.objective)}`,
    `Relevant conversation summary: ${String(input.conversationSummary ?? "")}`,
    `Geographies: ${(input.geographyHints as string[]).join(", ") || "not specified"}`,
    `Industries: ${(input.industryHints as string[]).join(", ") || "not specified"}`,
    `Research questions: ${(input.researchQuestions as string[]).join(" | ") || "not specified"}`,
    input.targetCompanyCount ? `Requested target company count: ${Number(input.targetCompanyCount)}` : "Recommend an appropriate target company count."
  ].join("\n");
}

function rejectSecretLikeContent(value: string) {
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
    /\b(?:api[_ -]?key|access[_ -]?token|password)\s*[:=]\s*\S{12,}/i
  ];
  if (patterns.some((pattern) => pattern.test(value))) {
    throw new ExternalMcpAccessError("forbidden", "Conversation summaries must not contain credentials or secrets.");
  }
}

function projectLinks(projectId: string) {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return { web: `${base}/?view=projects&project=${encodeURIComponent(projectId)}` };
}

function reportLinks(reportId: string) {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    web: `${base}/reports/${encodeURIComponent(reportId)}`,
    api: `${base}/api/v1/reports/${encodeURIComponent(reportId)}`
  };
}

function reportDocumentLink(documentId: string) {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/?view=documents&document=${encodeURIComponent(documentId)}`;
}

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "cross-project-report";
}

function buildCrossProjectReportContent(input: {
  title: string;
  objective: string;
  sections: string[];
  projects: Array<{ id: string; name: string }>;
  sources: Array<{
    citationKey: string;
    markdown: string;
    sourceUrl: string;
    document: { title: string; projectId: string | null };
    revision: { revision: number };
  }>;
}) {
  const sourceIndex = input.sources.map((source) =>
    `- [${source.citationKey}] [${source.document.title}](${source.sourceUrl}), approved revision ${source.revision.revision}`
  ).join("\n") || "- No approved sources matched the requested policy. Add or approve dossiers before relying on this report.";
  const citationList = input.sources.map((source) => `[${source.citationKey}](${source.sourceUrl})`).join(", ");
  const sectionContent = input.sections.map((section) =>
    `## ${section}\n\nReview and synthesize the approved evidence library below for this section. Available citations: ${citationList || "none"}.`
  ).join("\n\n");
  const evidenceLibrary = input.sources.map((source) => [
      `### ${source.document.title}`,
      `${source.markdown}\n\n[${source.citationKey}](${source.sourceUrl})`
    ].join("\n\n")).join("\n\n") || "No approved source material matched the requested policy.";
  return [
    `# ${input.title}`,
    "",
    "## Objective",
    "",
    input.objective,
    "",
    "## Source coverage",
    "",
    `Projects requested: ${input.projects.map((project) => project.name).join(", ")}`,
    "",
    "Only exact approved document revisions are included below. Source text is quoted as stored; this evidence packet does not convert source claims into independently verified conclusions.",
    "",
    sectionContent,
    "",
    "## Approved evidence library",
    "",
    evidenceLibrary,
    "",
    "## Sources",
    "",
    sourceIndex
  ].join("\n");
}
