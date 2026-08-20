import { z } from "zod";
import { buildContextPack } from "@/lib/context/retrieval";
import { findCompanyMatches } from "@/lib/company-research";
import { repository } from "@/lib/repository";
import { searchWorkspace } from "@/lib/search";
import { storeReportExport } from "@/lib/storage";
import { runResearchQuery } from "@/lib/research/engine";
import { createClientChangeSet, submitClientChangeSet } from "@/lib/client-changes";

export type McpRiskLevel = "low" | "medium" | "high" | "critical";
export type McpApprovalRequirement = "none" | "always";
export type McpToolGroup =
  | "search"
  | "project_context"
  | "knowledge"
  | "client_data"
  | "staged_write"
  | "reports"
  | "documents"
  | "storage"
  | "research";

export type InternalToolDefinition = {
  name: string;
  description: string;
  group: McpToolGroup;
  riskLevel: McpRiskLevel;
  approvalRequirement: McpApprovalRequirement;
  permissions: string[];
  budgetCents: number | null;
  inputSchema: z.ZodObject<z.ZodRawShape>;
};

export const internalToolCatalog = [
  {
    name: "search_workspace",
    description: "Search projects, agendas, documents, knowledge, and database metadata.",
    group: "search",
    riskLevel: "low",
    approvalRequirement: "none",
    permissions: ["workspace:read"],
    budgetCents: 0,
    inputSchema: z.object({ query: z.string().trim().min(2).max(500) })
  },
  {
    name: "get_project_context",
    description: "Build a bounded, cited context pack for one project and query.",
    group: "project_context",
    riskLevel: "low",
    approvalRequirement: "none",
    permissions: ["project:read"],
    budgetCents: 0,
    inputSchema: z.object({
      projectId: z.string().uuid(),
      query: z.string().trim().min(2).max(2000),
      tokenBudget: z.number().int().min(500).max(32000).default(8000)
    })
  },
  {
    name: "list_approved_knowledge",
    description: "List approved organization knowledge entries.",
    group: "knowledge",
    riskLevel: "low",
    approvalRequirement: "none",
    permissions: ["knowledge:read"],
    budgetCents: 0,
    inputSchema: z.object({ collection: z.string().trim().max(200).optional() })
  },
  {
    name: "list_client_records",
    description: "Read records from one approved client database.",
    group: "client_data",
    riskLevel: "medium",
    approvalRequirement: "none",
    permissions: ["client_data:read"],
    budgetCents: 0,
    inputSchema: z.object({
      databaseId: z.string().uuid(),
      limit: z.number().int().min(1).max(500).default(100)
    })
  },
  {
    name: "stage_client_records",
    description: "Create a durable client-data proposal for explicit review; never writes records directly.",
    group: "staged_write",
    riskLevel: "high",
    approvalRequirement: "always",
    permissions: ["client_data:propose"],
    budgetCents: 0,
    inputSchema: z.object({
      projectId: z.string().uuid(),
      agendaId: z.string().uuid().nullable().optional(),
      runId: z.string().uuid().nullable().optional(),
      databaseId: z.string().uuid(),
      title: z.string().trim().min(2).max(300),
      reason: z.string().max(5000).default(""),
      idempotencyKey: z.string().trim().min(8).max(200),
      records: z.array(z.record(z.string(), z.string())).min(1).max(500)
    })
  },
  {
    name: "create_working_report",
    description: "Create an editable working report attached to a project.",
    group: "reports",
    riskLevel: "medium",
    approvalRequirement: "none",
    permissions: ["report:create"],
    budgetCents: 0,
    inputSchema: z.object({
      projectId: z.string().uuid().nullable(),
      title: z.string().trim().min(2).max(180),
      summary: z.string().max(4000).default(""),
      content: z.string().max(100000).default("")
    })
  },
  {
    name: "get_document",
    description: "Read one document and its editable Markdown body.",
    group: "documents",
    riskLevel: "low",
    approvalRequirement: "none",
    permissions: ["document:read"],
    budgetCents: 0,
    inputSchema: z.object({ documentId: z.string().uuid() })
  },
  {
    name: "store_report_export",
    description: "Store an approved report export in Railway object storage and return a signed URL.",
    group: "storage",
    riskLevel: "medium",
    approvalRequirement: "none",
    permissions: ["storage:write"],
    budgetCents: 0,
    inputSchema: z.object({ reportId: z.string().uuid() })
  },
  {
    name: "match_canonical_company",
    description: "Match a company candidate against the canonical organization registry.",
    group: "research",
    riskLevel: "low",
    approvalRequirement: "none",
    permissions: ["research:read"],
    budgetCents: 0,
    inputSchema: z.object({
      legalName: z.string().trim().min(1).max(300),
      domain: z.string().trim().max(500).nullable().optional(),
      countryCode: z.string().trim().min(2).max(3).nullable().optional(),
      identifiers: z.array(z.object({
        type: z.string().trim().min(1).max(60),
        value: z.string().trim().min(1).max(200)
      })).max(100).default([])
    })
  },
  {
    name: "research_sources",
    description: "Run a budgeted, cached, cited query across governed research providers.",
    group: "research",
    riskLevel: "medium",
    approvalRequirement: "none",
    permissions: ["research:query"],
    budgetCents: 5,
    inputSchema: z.object({
      projectId: z.string().uuid(),
      agendaId: z.string().uuid(),
      // Optional, but supplying it is what lets a run's external research
      // spend be attributed back to that run. Without it the query is
      // recorded with a null run and no budget can ever see its cost.
      runId: z.string().uuid().nullable().optional(),
      query: z.string().trim().min(2).max(2000),
      category: z.enum(["web", "company", "government", "economic", "korean", "academic", "reference"]),
      language: z.string().trim().min(2).max(10).default("en"),
      queryBudget: z.number().int().min(1).max(100).default(10),
      maxResults: z.number().int().min(1).max(100).default(20)
    })
  }
] as const satisfies readonly InternalToolDefinition[];

export type InternalToolName = typeof internalToolCatalog[number]["name"];

export function getInternalTool(name: string) {
  return internalToolCatalog.find((tool) => tool.name === name);
}

export async function executeInternalTool(name: InternalToolName, rawInput: unknown) {
  const tool = getInternalTool(name);
  if (!tool) throw new Error(`Unknown internal tool: ${name}`);
  const input = tool.inputSchema.parse(rawInput) as Record<string, unknown>;

  if (name === "search_workspace") {
    return { hits: await searchWorkspace(String(input.query)) };
  }
  if (name === "get_project_context") {
    return buildContextPack({
      projectId: String(input.projectId),
      query: String(input.query),
      tokenBudget: Number(input.tokenBudget)
    });
  }
  if (name === "list_approved_knowledge") {
    const collection = typeof input.collection === "string" ? input.collection : null;
    return {
      entries: (await repository.listKnowledge()).filter((entry) =>
        entry.status === "approved" && (!collection || entry.collection === collection)
      )
    };
  }
  if (name === "list_client_records") {
    const records = await repository.listRecords(String(input.databaseId));
    return { records: records.slice(0, Number(input.limit)) };
  }
  if (name === "stage_client_records") {
    const changeSet = await createClientChangeSet({
      projectId: String(input.projectId),
      agendaId: typeof input.agendaId === "string" ? input.agendaId : null,
      runId: typeof input.runId === "string" ? input.runId : null,
      databaseId: String(input.databaseId),
      title: String(input.title),
      reason: String(input.reason),
      idempotencyKey: String(input.idempotencyKey),
      items: (input.records as Array<Record<string, string>>).map((record) => ({
        operation: "insert" as const,
        after: record
      }))
    });
    const submitted = changeSet.status === "draft"
      ? await submitClientChangeSet(changeSet.id)
      : changeSet;
    return {
      staged: true,
      changeSet: submitted,
      message: "Proposal submitted for review. No client data was changed."
    };
  }
  if (name === "create_working_report") {
    return repository.createReport({
      projectId: typeof input.projectId === "string" ? input.projectId : null,
      title: String(input.title),
      summary: String(input.summary),
      content: String(input.content)
    });
  }
  if (name === "get_document") {
    const document = await repository.getDocument(String(input.documentId));
    if (!document) throw new Error("Document not found.");
    return document;
  }
  if (name === "store_report_export") {
    const report = (await repository.listReports()).find((item) => item.id === input.reportId);
    if (!report) throw new Error("Report not found.");
    return storeReportExport(report.id, report.title, report.content);
  }
  if (name === "match_canonical_company") {
    return {
      matches: await findCompanyMatches({
        legalName: String(input.legalName),
        domain: typeof input.domain === "string" ? input.domain : null,
        countryCode: typeof input.countryCode === "string" ? input.countryCode : null,
        identifiers: input.identifiers as Array<{ type: string; value: string }>
      })
    };
  }
  if (name === "research_sources") {
    return runResearchQuery({
      projectId: String(input.projectId),
      agendaId: String(input.agendaId),
      runId: typeof input.runId === "string" ? input.runId : null,
      query: String(input.query),
      category: input.category as "web" | "company" | "government" | "economic" | "korean" | "academic" | "reference",
      language: String(input.language),
      queryBudget: Number(input.queryBudget),
      maxResults: Number(input.maxResults)
    });
  }
  throw new Error(`Tool handler not implemented: ${name}`);
}

export const mcpExtensionGroups = [
  "crm",
  "calendar",
  "analytics",
  "publishing",
  "erp",
  "accounting",
  "cloud_storage",
  "manufacturing"
] as const;
