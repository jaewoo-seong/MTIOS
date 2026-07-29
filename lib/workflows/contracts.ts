import { z } from "zod";

export const workerTypes = [
  "research",
  "company_intelligence",
  "marketing_strategy",
  "ideation",
  "content_writing",
  "editing",
  "extraction",
  "data_enrichment",
  "document_generation",
  "email_drafting",
  "translation",
  "quality_review"
] as const;

export const workerTypeSchema = z.enum(workerTypes);
export type WorkerType = z.infer<typeof workerTypeSchema>;

export const delegatedTaskSchema = z.object({
  key: z.string().trim().min(1).max(80),
  workerType: workerTypeSchema,
  instruction: z.string().trim().min(5).max(12000),
  expectedOutput: z.string().trim().min(2).max(1000),
  toolScopes: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  budgetCents: z.number().int().min(0).max(1000000).default(0),
  reviewRequired: z.boolean().default(false)
});

export const executionPlanSchema = z.object({
  objective: z.string().trim().min(5).max(2000),
  reportTitle: z.string().trim().min(2).max(180),
  tasks: z.array(delegatedTaskSchema).min(1).max(20),
  reviewRecommendation: z.string().trim().max(2000).default(""),
  estimatedCostCents: z.number().int().min(0).max(5000000)
}).superRefine((plan, ctx) => {
  if (new Set(plan.tasks.map((task) => task.key)).size !== plan.tasks.length) {
    ctx.addIssue({ code: "custom", message: "Task keys must be unique.", path: ["tasks"] });
  }
  const taskBudget = plan.tasks.reduce((sum, task) => sum + task.budgetCents, 0);
  if (taskBudget > plan.estimatedCostCents) {
    ctx.addIssue({ code: "custom", message: "Task budgets exceed plan estimate.", path: ["estimatedCostCents"] });
  }
});

export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
export type DelegatedTask = z.infer<typeof delegatedTaskSchema>;

export const workerResultSchema = z.object({
  taskKey: z.string().trim().min(1).max(80),
  workerType: workerTypeSchema,
  summary: z.string().trim().min(1).max(10000),
  findings: z.array(z.object({
    statement: z.string().trim().min(1).max(5000),
    confidence: z.number().min(0).max(1),
    sourceRefs: z.array(z.string().trim().min(1).max(500)).max(50).default([])
  })).max(100).default([]),
  artifacts: z.array(z.object({
    type: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(240),
    content: z.string().max(100000)
  })).max(20).default([]),
  assumptions: z.array(z.string().trim().min(1).max(2000)).max(50).default([]),
  unresolvedQuestions: z.array(z.string().trim().min(1).max(2000)).max(50).default([]),
  reviewRequired: z.boolean().default(false)
});

export type WorkerResult = z.infer<typeof workerResultSchema>;

export const workerCatalog: Record<WorkerType, {
  modelRoute:
    | "worker_research"
    | "worker_creative"
    | "worker_writing"
    | "worker_editing"
    | "worker_structured"
    | "worker_translation"
    | "worker_fast";
  systemPrompt: string;
}> = {
  research: { modelRoute: "worker_research", systemPrompt: "Research claims. Preserve sources and uncertainty." },
  company_intelligence: { modelRoute: "worker_research", systemPrompt: "Analyze company facts, identity, evidence, and gaps." },
  marketing_strategy: { modelRoute: "worker_structured", systemPrompt: "Develop evidence-based marketing strategy and alternatives." },
  ideation: { modelRoute: "worker_creative", systemPrompt: "Generate distinct ideas, evaluation criteria, and tradeoffs." },
  content_writing: { modelRoute: "worker_writing", systemPrompt: "Draft content using approved claims, voice, and constraints." },
  editing: { modelRoute: "worker_editing", systemPrompt: "Edit for accuracy, structure, consistency, and audience." },
  extraction: { modelRoute: "worker_structured", systemPrompt: "Extract requested fields without inventing missing values." },
  data_enrichment: { modelRoute: "worker_structured", systemPrompt: "Propose sourced enrichment; never mutate client data directly." },
  document_generation: { modelRoute: "worker_structured", systemPrompt: "Create structured document content and explicit sections." },
  email_drafting: { modelRoute: "worker_writing", systemPrompt: "Draft email only. Never send. Flag claims needing review." },
  translation: { modelRoute: "worker_translation", systemPrompt: "Translate faithfully while preserving technical terminology." },
  quality_review: { modelRoute: "worker_structured", systemPrompt: "Review evidence, contradictions, omissions, and approval needs." }
};

export function workerResultJsonInstruction(task: DelegatedTask) {
  return [
    workerCatalog[task.workerType].systemPrompt,
    "Return JSON only matching:",
    '{"taskKey":"string","workerType":"string","summary":"string","findings":[{"statement":"string","confidence":0.0,"sourceRefs":["string"]}],"artifacts":[{"type":"string","title":"string","content":"string"}],"assumptions":["string"],"unresolvedQuestions":["string"],"reviewRequired":false}'
  ].join("\n");
}
