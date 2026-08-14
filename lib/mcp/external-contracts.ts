import { z } from "zod";

const uuid = z.string().uuid();
const cursor = z.string().trim().min(1).max(500).nullable().default(null);
const idempotencyKey = z.string().trim().min(8).max(200);
const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const externalMcpScopes = [
  "organization:read",
  "projects:read",
  "companies:read",
  "documents:read",
  "evidence:read",
  "projects:draft",
  "research:execute",
  "reports:create"
] as const;

export type ExternalMcpScope = typeof externalMcpScopes[number];

const linkSchema = z.object({
  web: z.string().url(),
  api: z.string().url().optional()
});

const pageSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean()
});

const sourceReferenceSchema = z.object({
  sourceId: uuid,
  sourceKind: z.enum(["project", "company", "dossier", "document", "evidence"]),
  projectId: uuid.nullable(),
  companyId: uuid.nullable(),
  documentId: uuid.nullable(),
  title: z.string(),
  url: z.string().url().nullable(),
  observedAt: z.string().datetime().nullable(),
  confidence: z.number().min(0).max(1).nullable()
});

export const listResearchProjectsInput = z.object({
  status: z.enum(["draft", "active", "paused", "completed", "archived"]).optional(),
  query: z.string().trim().max(300).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor
}).strict();

export const listResearchProjectsOutput = z.object({
  projects: z.array(z.object({
    id: uuid,
    name: z.string(),
    objective: z.string(),
    status: z.string(),
    activeStrategyVersionId: uuid.nullable(),
    companyCount: z.number().int().nonnegative(),
    dossierCount: z.number().int().nonnegative(),
    lastActivityAt: z.string().datetime(),
    links: linkSchema
  })),
  page: pageSchema
});

export const getResearchProjectInput = z.object({
  projectId: uuid,
  include: z.array(z.enum(["strategy", "status", "counts"])).max(3).default(["strategy", "status", "counts"])
}).strict();

export const getResearchProjectOutput = z.object({
  project: z.object({
    id: uuid,
    name: z.string(),
    objective: z.string(),
    status: z.string(),
    strategy: z.record(z.string(), z.unknown()).nullable(),
    counts: z.object({ companies: z.number().int().nonnegative(), dossiers: z.number().int().nonnegative(), documents: z.number().int().nonnegative() }).nullable(),
    links: linkSchema
  })
});

export const getProjectBriefingInput = z.object({
  projectId: uuid,
  topic: z.string().trim().max(2000).default(""),
  includeOrganizationContext: z.boolean().default(true)
}).strict();

export const getProjectBriefingOutput = z.object({
  organization: z.object({
    id: uuid,
    name: z.string(),
    approvedContext: z.array(z.object({ title: z.string(), content: z.string().max(4000) })).max(10)
  }),
  externalAssistant: z.object({
    role: z.string(),
    expectations: z.array(z.string()),
    limits: z.array(z.string())
  }),
  project: z.object({
    id: uuid,
    name: z.string(),
    objective: z.string(),
    status: z.string(),
    context: z.string(),
    scope: z.string(),
    constraints: z.array(z.string()),
    activeStrategy: z.record(z.string(), z.unknown()).nullable(),
    links: linkSchema
  }),
  businessOsAgents: z.array(z.object({
    name: z.string(),
    role: z.string(),
    description: z.string(),
    capabilities: z.array(z.string()),
    reviewRequired: z.boolean()
  })),
  brainstorming: z.object({
    topic: z.string(),
    guidance: z.array(z.string()),
    suggestedEvaluationCriteria: z.array(z.string())
  }),
  warnings: z.array(z.string())
});

export const draftResearchProjectInput = z.object({
  title: boundedText(180),
  objective: boundedText(4000),
  conversationSummary: z.string().trim().max(12000).default(""),
  geographyHints: z.array(boundedText(120)).max(25).default([]),
  industryHints: z.array(boundedText(120)).max(25).default([]),
  researchQuestions: z.array(boundedText(500)).max(30).default([]),
  targetCompanyCount: z.number().int().min(1).max(1000).optional(),
  idempotencyKey
}).strict();

export const draftResearchProjectOutput = z.object({
  projectId: uuid,
  strategyVersionId: uuid,
  status: z.literal("draft"),
  proposal: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()),
  clarificationQuestions: z.array(z.string()),
  requiresApproval: z.literal(true),
  links: linkSchema
});

export const activateResearchProjectInput = z.object({
  projectId: uuid,
  strategyVersionId: uuid,
  confirmation: z.literal("I approve starting this research project."),
  idempotencyKey
}).strict();

export const activateResearchProjectOutput = z.object({
  projectId: uuid,
  strategyVersionId: uuid,
  status: z.enum(["queued", "running", "active"]),
  runId: uuid.nullable(),
  links: linkSchema
});

export const searchBusinessOsInput = z.object({
  query: boundedText(2000),
  projectIds: z.array(uuid).max(50).default([]),
  kinds: z.array(z.enum(["company", "dossier", "document", "evidence"])).max(4).default(["company", "dossier", "document", "evidence"]),
  limit: z.number().int().min(1).max(50).default(10),
  cursor
}).strict();

export const searchBusinessOsOutput = z.object({
  results: z.array(z.object({
    id: uuid,
    kind: z.enum(["company", "dossier", "document", "evidence"]),
    title: z.string(),
    excerpt: z.string().max(2000),
    reference: sourceReferenceSchema,
    links: linkSchema
  })),
  page: pageSchema
});

export const getCompanyResearchInput = z.object({
  companyId: uuid,
  include: z.array(z.enum(["record", "primary_dossier", "supporting_documents", "evidence_summary"])).max(4)
    .default(["record", "primary_dossier", "supporting_documents", "evidence_summary"])
}).strict();

export const getCompanyResearchOutput = z.object({
  companyId: uuid,
  record: z.record(z.string(), z.unknown()).nullable(),
  primaryDossier: sourceReferenceSchema.nullable(),
  supportingDocuments: z.array(sourceReferenceSchema),
  evidenceSummary: z.object({ count: z.number().int().nonnegative(), gaps: z.array(z.string()) }).nullable(),
  warnings: z.array(z.string())
});

export const getExternalDocumentInput = z.object({
  documentId: uuid,
  format: z.literal("markdown").default("markdown"),
  maxCharacters: z.number().int().min(1000).max(50000).default(30000)
}).strict();

export const getExternalDocumentOutput = z.object({
  documentId: uuid,
  title: z.string(),
  markdown: z.string(),
  revision: z.number().int().positive(),
  approvalState: z.string(),
  sources: z.array(sourceReferenceSchema),
  truncated: z.boolean(),
  returnedCharacters: z.number().int().nonnegative(),
  totalCharacters: z.number().int().nonnegative(),
  links: linkSchema
});

export const createCrossProjectReportInput = z.object({
  title: boundedText(180),
  projectIds: z.array(uuid).min(1).max(20),
  objective: boundedText(4000),
  sections: z.array(boundedText(200)).min(1).max(20),
  evidencePolicy: z.enum(["approved_dossiers_only", "approved_sources"]).default("approved_dossiers_only"),
  sourceDocumentIds: z.array(uuid).max(100).default([]),
  maxSources: z.number().int().min(1).max(100).default(40),
  maxSourceCharacters: z.number().int().min(10000).max(200000).default(80000),
  confirmation: z.literal("I approve creating this report."),
  idempotencyKey
}).strict();

export const createCrossProjectReportOutput = z.object({
  reportDocumentId: uuid,
  status: z.enum(["queued", "running", "ready", "failed"]),
  sourceCoverage: z.object({
    requestedProjectCount: z.number().int().positive(),
    includedProjectCount: z.number().int().nonnegative(),
    sourceCount: z.number().int().nonnegative()
  }),
  links: linkSchema
});

export const externalMcpToolCatalog = [
  { name: "list_research_projects", scopes: ["projects:read"], write: false, inputSchema: listResearchProjectsInput, outputSchema: listResearchProjectsOutput },
  { name: "get_research_project", scopes: ["projects:read"], write: false, inputSchema: getResearchProjectInput, outputSchema: getResearchProjectOutput },
  { name: "get_project_briefing", scopes: ["projects:read"], write: false, inputSchema: getProjectBriefingInput, outputSchema: getProjectBriefingOutput },
  { name: "draft_research_project", scopes: ["projects:draft"], write: true, inputSchema: draftResearchProjectInput, outputSchema: draftResearchProjectOutput },
  { name: "activate_research_project", scopes: ["research:execute"], write: true, inputSchema: activateResearchProjectInput, outputSchema: activateResearchProjectOutput },
  { name: "search_business_os", scopes: ["projects:read", "companies:read", "documents:read", "evidence:read"], write: false, inputSchema: searchBusinessOsInput, outputSchema: searchBusinessOsOutput },
  { name: "get_company_research", scopes: ["companies:read"], write: false, inputSchema: getCompanyResearchInput, outputSchema: getCompanyResearchOutput },
  { name: "get_document", scopes: ["documents:read"], write: false, inputSchema: getExternalDocumentInput, outputSchema: getExternalDocumentOutput },
  { name: "create_cross_project_report", scopes: ["reports:create"], write: true, inputSchema: createCrossProjectReportInput, outputSchema: createCrossProjectReportOutput }
] as const satisfies ReadonlyArray<{
  name: string;
  scopes: readonly ExternalMcpScope[];
  write: boolean;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
}>;
