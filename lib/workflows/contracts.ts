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

// Kept as a plain object (no .superRefine) separately from the exported,
// refined `executionPlanSchema` below, so this base shape can also be
// unioned into `plannerResponseSchema` further down - Zod's
// discriminatedUnion requires each member to be a plain object schema, not
// a ZodEffects produced by .superRefine().
const executionPlanObjectSchema = z.object({
  objective: z.string().trim().min(5).max(2000),
  reportTitle: z.string().trim().min(2).max(180),
  tasks: z.array(delegatedTaskSchema).min(1).max(20),
  reviewRecommendation: z.string().trim().max(2000).default(""),
  estimatedCostCents: z.number().int().min(0).max(5000000)
});

function validateExecutionPlan(
  plan: z.infer<typeof executionPlanObjectSchema>,
  ctx: z.RefinementCtx
) {
  if (new Set(plan.tasks.map((task) => task.key)).size !== plan.tasks.length) {
    ctx.addIssue({ code: "custom", message: "Task keys must be unique.", path: ["tasks"] });
  }
  const taskBudget = plan.tasks.reduce((sum, task) => sum + task.budgetCents, 0);
  if (taskBudget > plan.estimatedCostCents) {
    ctx.addIssue({ code: "custom", message: "Task budgets exceed plan estimate.", path: ["estimatedCostCents"] });
  }
}

export const executionPlanSchema = executionPlanObjectSchema.superRefine(validateExecutionPlan);

export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
export type DelegatedTask = z.infer<typeof delegatedTaskSchema>;

/**
 * Phase 13 Stage 2 - Blueprint. The planner's output when an instruction is
 * shaped like "find N entities matching criteria, one document each,
 * presented as a database" rather than a fixed task pipeline. Everything
 * about the entity type is inferred here, per project, from the user's own
 * instruction text - nothing about companies or any other specific domain
 * is hard-coded in this schema.
 */
export const collectionEntityFieldSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(300)
});

// Same reasoning as executionPlanObjectSchema above: kept plain so it can
// be unioned; the refined, exported `collectionPlanSchema` wraps it.
const collectionPlanObjectSchema = z.object({
  kind: z.literal("collection_project"),
  campaignName: z.string().trim().min(2).max(200),
  objective: z.string().trim().min(5).max(2000),
  entitySchema: z.array(collectionEntityFieldSchema).min(1).max(20),
  documentTemplate: z.string().trim().min(10).max(4000),
  dedupeKeys: z.array(z.string().trim().min(1).max(60)).min(1).max(5),
  qualificationRules: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  discoveryQueries: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
  targetCount: z.number().int().min(1).max(100000).nullable().default(null),
  saturationRule: z.string().trim().max(500).nullable().default(null)
});

function validateCollectionPlan(
  plan: z.infer<typeof collectionPlanObjectSchema>,
  ctx: z.RefinementCtx
) {
  const fieldNames = new Set(plan.entitySchema.map((field) => field.name));
  for (const key of plan.dedupeKeys) {
    if (!fieldNames.has(key)) {
      ctx.addIssue({
        code: "custom",
        message: `Dedupe key "${key}" is not one of the declared entity fields.`,
        path: ["dedupeKeys"]
      });
    }
  }
  if (plan.targetCount === null && plan.saturationRule === null) {
    ctx.addIssue({
      code: "custom",
      message: "A collection plan needs a targetCount or a saturationRule so the Scouting Loop knows when to stop.",
      path: ["targetCount"]
    });
  }
}

export const collectionPlanSchema = collectionPlanObjectSchema.superRefine(validateCollectionPlan);

export type CollectionPlan = z.infer<typeof collectionPlanSchema>;

/**
 * What the planner actually returns: either the existing fixed task
 * pipeline, or a collection-project blueprint. `kind` discriminates and is
 * required on both branches - not defaulted, so the discriminator itself
 * never depends on an unwrapped default being visible to
 * `discriminatedUnion` at parse time. Cross-field validation for each
 * branch runs after the union, via the same functions the standalone
 * schemas above use, so there is one source of truth for each branch's
 * rules, not two.
 */
export const plannerResponseSchema = z.discriminatedUnion("kind", [
  executionPlanObjectSchema.extend({ kind: z.literal("tasks") }),
  collectionPlanObjectSchema
]).superRefine((plan, ctx) => {
  if (plan.kind === "tasks") validateExecutionPlan(plan, ctx);
  else validateCollectionPlan(plan, ctx);
});

export type PlannerResponse = z.infer<typeof plannerResponseSchema>;

/**
 * Phase 13 Stage 4 - Dossier Loop. `fields` is deliberately an open record:
 * the field names come from the campaign's own entitySchema, which was
 * inferred per project at Blueprint time, so there is no fixed key set to
 * validate against here. `qualifies` is separate from the field values
 * because a candidate can be well-documented and still fail the campaign's
 * qualification rules.
 */
export const dossierQueryPlanSchema = z.object({
  queries: z.array(z.string().trim().min(1).max(300)).max(10).default([])
});

export const dossierExtractionSchema = z.object({
  qualifies: z.boolean(),
  reason: z.string().trim().max(2000).default(""),
  fields: z.record(z.string(), z.unknown()).default({})
});

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
