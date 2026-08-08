import { and, asc, count, desc, eq, gt, max, sql as drizzleSql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type {
  Agenda,
  AgentDefinition,
  AgentRun,
  ClientDatabase,
  ClientRecord,
  CommandContext,
  Deliverable,
  DocumentFolder,
  ExecutiveCommand,
  KnowledgeEntry,
  Milestone,
  Project,
  ProjectRecord,
  Report,
  ReviewDecision,
  RunEvent,
  WorkspaceDocument,
  WorkspaceDocumentDetail,
  WorkTask
} from "@/lib/domain";
import { db } from "@/lib/db/client";
import {
  agentDefinitions,
  agendas,
  budgetLedgers,
  clientDatabases,
  clientRecords,
  commandRevisions,
  commands,
  deliverables,
  documentFolders,
  documents,
  knowledgeEntries,
  modelCalls,
  milestones,
  projectRecords,
  projectResearchSettings,
  projects,
  reports,
  reviewDecisions as reviewDecisionRows,
  reviews,
  runEvents,
  runs,
  tasks
} from "@/lib/db/schema";

export const MTI_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
export const MTI_OPERATOR_ID = "00000000-0000-4000-8000-000000000002";

type StoredDocument = WorkspaceDocumentDetail;

export type ProjectActivityEvent = RunEvent & { runStatus: AgentRun["status"] };

type Store = {
  projects: Project[];
  agendas: Agenda[];
  milestones: Milestone[];
  projectRecords: ProjectRecord[];
  deliverables: Deliverable[];
  tasks: WorkTask[];
  agents: AgentDefinition[];
  commands: ExecutiveCommand[];
  reports: Report[];
  knowledge: KnowledgeEntry[];
  clientDatabases: ClientDatabase[];
  events: RunEvent[];
  runs: AgentRun[];
  reviewDecisions: ReviewDecision[];
  folders: Omit<DocumentFolder, "documentCount">[];
  documents: StoredDocument[];
  records: ClientRecord[];
  modelUsage: Array<{
    id: string; runId: string; route: string; model: string | null;
    provider: string | null; inputTokens: number; outputTokens: number;
    costMicros: number; latencyMs: number; error: string | null;
    fallbackReason: string | null; licensingStatus: string; environment: string;
    attemptCount: number; structuredOutputValid: boolean | null;
    requestBudgetMicros: number | null;
  }>;
};

export const DEFAULT_FOLDERS = ["Inbox", "Project files", "Reports", "Reference"];

const globalStore = globalThis as typeof globalThis & { __businessOsStore?: Partial<Store> };

const emptyStore = (): Store => ({
  projects: [],
  agendas: [],
  milestones: [],
  projectRecords: [],
  deliverables: [],
  tasks: [],
  agents: [
    {
      id: "00000000-0000-4000-8000-000000000010",
      organizationId: MTI_ORGANIZATION_ID,
      name: "Executive Agent",
      role: "executive",
      modelRoute: "executive_reasoning",
      capabilities: [
        "research", "marketing", "brainstorming", "content", "data_enrichment",
        "document", "communication", "analysis", "operations", "custom"
      ],
      toolScopes: [
        "project:read", "knowledge:read", "plan:create", "task:delegate",
        "workspace:read", "client_data:read", "client_data:propose",
        "report:create", "document:read", "storage:write", "research:read",
        "research:query"
      ],
      budgetCents: null,
      outputSchema: {},
      reviewRequired: true,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "00000000-0000-4000-8000-000000000011",
      organizationId: MTI_ORGANIZATION_ID,
      name: "General Worker",
      role: "worker",
      modelRoute: "worker_fast",
      capabilities: [
        "research", "marketing", "brainstorming", "content", "data_enrichment",
        "document", "analysis", "operations"
      ],
      toolScopes: [
        "project:read", "knowledge:read", "output:propose",
        "workspace:read", "client_data:read", "report:create",
        "document:read", "storage:write", "research:read", "research:query"
      ],
      budgetCents: null,
      outputSchema: {},
      reviewRequired: false,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  commands: [],
  reports: [],
  knowledge: [],
  clientDatabases: [],
  events: [],
  runs: [],
  reviewDecisions: [],
  folders: DEFAULT_FOLDERS.map((name, index) => ({
    id: `folder-${index}-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    system: index === 0,
    createdAt: new Date().toISOString()
  })),
  documents: [],
  records: [],
  modelUsage: []
});

/**
 * Merge onto whatever is already on the global rather than replacing it. A store
 * created by an earlier build of this module is missing any collection added
 * since, and reading one of those would throw on first access.
 */
const store: Store = Object.assign(emptyStore(), globalStore.__businessOsStore ?? {});
for (const [key, value] of Object.entries(emptyStore()) as [keyof Store, unknown][]) {
  if (!Array.isArray(store[key])) {
    (store as Record<keyof Store, unknown>)[key] = value;
  }
}
globalStore.__businessOsStore = store;

const now = () => new Date().toISOString();
const iso = (date: Date) => date.toISOString();

const projectRow = (row: typeof projects.$inferSelect): Project => ({
  ...row,
  constraints: row.constraints ?? [],
  budgetCents: row.budgetCents ?? null,
  budgetCurrency: row.budgetCurrency as Project["budgetCurrency"],
  permissions: row.permissions,
  reviewGates: row.reviewGates ?? [],
  outputRequirements: row.outputRequirements ?? [],
  outputLanguage: row.outputLanguage as Project["outputLanguage"],
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const agendaRow = (row: typeof agendas.$inferSelect): Agenda => ({
  id: row.id,
  projectId: row.projectId,
  title: row.title,
  instruction: row.instruction,
  workType: row.workType,
  status: row.status,
  revision: row.revision,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const commandRow = (row: typeof commands.$inferSelect): ExecutiveCommand => ({
  id: row.id,
  organizationId: row.organizationId,
  projectId: row.projectId,
  page: row.page,
  instruction: row.instruction,
  status: row.status,
  clarification: row.clarification,
  context: row.context as unknown as CommandContext,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const milestoneRow = (row: typeof milestones.$inferSelect): Milestone => ({
  id: row.id,
  projectId: row.projectId,
  title: row.title,
  description: row.description,
  status: row.status as Milestone["status"],
  dueAt: row.dueAt ? iso(row.dueAt) : null,
  position: row.position,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const projectRecordRow = (row: typeof projectRecords.$inferSelect): ProjectRecord => ({
  id: row.id,
  projectId: row.projectId,
  agendaId: row.agendaId,
  kind: row.kind as ProjectRecord["kind"],
  content: row.content,
  status: row.status as ProjectRecord["status"],
  sourceRunId: row.sourceRunId,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const deliverableRow = (row: typeof deliverables.$inferSelect): Deliverable => ({
  id: row.id,
  projectId: row.projectId,
  agendaId: row.agendaId,
  runId: row.runId,
  title: row.title,
  type: row.type,
  status: row.status as Deliverable["status"],
  reviewRequired: row.reviewRequired,
  reportId: row.reportId,
  documentId: row.documentId,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const taskRow = (row: typeof tasks.$inferSelect): WorkTask => ({
  id: row.id,
  agendaId: row.agendaId,
  title: row.title,
  description: row.description,
  status: row.status,
  assignedAgentId: row.assignedAgentId,
  dependsOn: row.dependsOn ?? [],
  toolScopes: row.toolScopes ?? [],
  outputSchema: row.outputSchema ?? {},
  budgetCents: row.budgetCents,
  reviewRequired: row.reviewRequired,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const agentRow = (row: typeof agentDefinitions.$inferSelect): AgentDefinition => ({
  id: row.id,
  organizationId: row.organizationId,
  name: row.name,
  role: row.role as AgentDefinition["role"],
  modelRoute: row.modelRoute,
  capabilities: row.capabilities as AgentDefinition["capabilities"],
  toolScopes: row.toolScopes,
  budgetCents: row.budgetCents,
  outputSchema: row.outputSchema,
  reviewRequired: row.reviewRequired,
  active: row.active,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const reportRow = (row: typeof reports.$inferSelect): Report => ({
  id: row.id,
  projectId: row.projectId,
  title: row.title,
  summary: row.summary,
  content: row.content,
  status: row.status,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const knowledgeRow = (row: typeof knowledgeEntries.$inferSelect): KnowledgeEntry => ({
  id: row.id,
  collection: row.collection,
  title: row.title,
  content: row.content,
  status: row.status,
  source: row.source,
  createdAt: iso(row.createdAt)
});

const clientDatabaseRow = (row: typeof clientDatabases.$inferSelect): ClientDatabase => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  description: row.description,
  recordCount: 0,
  createdAt: iso(row.createdAt)
});

export const repository = {
  async listProjects() {
    if (!db) return store.projects;
    return (await db.select().from(projects)
      .where(eq(projects.organizationId, MTI_ORGANIZATION_ID))
      .orderBy(desc(projects.updatedAt))).map(projectRow);
  },
  async getProject(id: string) {
    if (!db) return store.projects.find((item) => item.id === id);
    const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return row?.organizationId === MTI_ORGANIZATION_ID ? projectRow(row) : undefined;
  },
  async createProject(input:
    Omit<Project, "id" | "organizationId" | "status" | "createdAt" | "updatedAt" | "permissions" | "reviewGates" | "outputRequirements" | "outputLanguage" | "budgetCurrency">
    & Partial<Pick<Project, "permissions" | "reviewGates" | "outputRequirements" | "outputLanguage" | "budgetCurrency">>
  , actorId = MTI_OPERATOR_ID) {
    const governance = {
      permissions: input.permissions ?? {
        externalSend: "review_required" as const,
        clientDataWrite: "review_required" as const,
        destructiveAction: "review_required" as const
      },
      reviewGates: input.reviewGates ?? [],
      outputRequirements: input.outputRequirements ?? [],
      outputLanguage: input.outputLanguage ?? "en",
      budgetCurrency: input.budgetCurrency ?? "USD"
    };
    if (!db) {
      const project: Project = {
        id: crypto.randomUUID(),
        organizationId: MTI_ORGANIZATION_ID,
        status: "active",
        createdAt: now(),
        updatedAt: now(),
        ...governance,
        ...input
      };
      store.projects.unshift(project);
      store.clientDatabases.unshift({
        id: crypto.randomUUID(), projectId: project.id,
        name: `${project.name} companies`, description: `Companies researched for ${project.name}.`,
        recordCount: 0, createdAt: now()
      });
      return project;
    }
    return db.transaction(async (tx) => {
      const [row] = await tx.insert(projects).values({
        organizationId: MTI_ORGANIZATION_ID,
        ownerId: actorId,
        ...governance,
        ...input
      }).returning();
      await Promise.all([
        tx.insert(projectResearchSettings).values({
          organizationId: MTI_ORGANIZATION_ID,
          projectId: row.id
        }),
        tx.insert(clientDatabases).values({
          organizationId: MTI_ORGANIZATION_ID,
          projectId: row.id,
          name: `${row.name} companies`,
          description: `Companies researched for ${row.name}.`
        })
      ]);
      return projectRow(row);
    });
  },
  async updateProject(id: string, input: Partial<Project>) {
    if (!db) {
      const project = store.projects.find((item) => item.id === id);
      if (!project) return null;
      Object.assign(project, input, { id, organizationId: project.organizationId, updatedAt: now() });
      return project;
    }
    const { id: _id, organizationId: _organizationId, createdAt: _createdAt, updatedAt: _updatedAt, ...values } = input;
    const [row] = await db.update(projects).set({ ...values, updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.organizationId, MTI_ORGANIZATION_ID))).returning();
    return row ? projectRow(row) : null;
  },
  async listAgendas(projectId: string) {
    if (!db) return store.agendas.filter((item) => item.projectId === projectId);
    return (await db.select().from(agendas).where(eq(agendas.projectId, projectId))
      .orderBy(desc(agendas.createdAt))).map(agendaRow);
  },
  async getAgenda(id: string) {
    if (!db) {
      const agenda = store.agendas.find((item) => item.id === id);
      if (!agenda) return undefined;
      return store.projects.some((project) =>
        project.id === agenda.projectId && project.organizationId === MTI_ORGANIZATION_ID
      ) ? agenda : undefined;
    }
    const [row] = await db.select({ agenda: agendas, organizationId: projects.organizationId })
      .from(agendas)
      .innerJoin(projects, eq(agendas.projectId, projects.id))
      .where(eq(agendas.id, id))
      .limit(1);
    return row?.organizationId === MTI_ORGANIZATION_ID ? agendaRow(row.agenda) : undefined;
  },
  async createAgenda(projectId: string, input: Pick<Agenda, "title" | "instruction"> & Partial<Pick<Agenda, "workType">>, actorId = MTI_OPERATOR_ID) {
    if (!db) {
      const agenda: Agenda = {
        id: crypto.randomUUID(), projectId, status: "queued",
        workType: input.workType ?? "custom", revision: 1,
        createdAt: now(), updatedAt: now(), ...input
      };
      store.agendas.unshift(agenda);
      return agenda;
    }
    const [row] = await db.insert(agendas).values({ projectId, createdBy: actorId, ...input }).returning();
    return agendaRow(row);
  },
  async createCommand(input: Pick<ExecutiveCommand, "page" | "projectId" | "instruction"> & {
    context?: CommandContext;
  }, actorId = MTI_OPERATOR_ID) {
    const needsClarification = input.instruction.trim().split(/\s+/).length < 8;
    const status = needsClarification ? "needs_clarification" : "awaiting_confirmation";
    const clarification = needsClarification
      ? "What outcome should be produced, and which project or records should this instruction affect?"
      : "Confirm the scope and review gates before execution.";
    if (!db) {
      const command: ExecutiveCommand = {
        id: crypto.randomUUID(), organizationId: MTI_ORGANIZATION_ID,
        ...input, context: input.context ?? { page: input.page, projectId: input.projectId },
        status, clarification, createdAt: now(), updatedAt: now()
      };
      store.commands.unshift(command);
      return command;
    }
    const [row] = await db.insert(commands).values({
      organizationId: MTI_ORGANIZATION_ID, ...input,
      context: input.context ?? { page: input.page, projectId: input.projectId },
      status, clarification, createdBy: actorId
    }).returning();
    return commandRow(row);
  },
  async getCommand(id: string) {
    if (!db) return store.commands.find((item) => item.id === id);
    const [row] = await db.select().from(commands).where(eq(commands.id, id)).limit(1);
    return row?.organizationId === MTI_ORGANIZATION_ID ? commandRow(row) : undefined;
  },
  async updateCommand(id: string, input: Partial<ExecutiveCommand>) {
    if (!db) {
      const command = store.commands.find((item) => item.id === id);
      if (!command) return null;
      Object.assign(command, input, { id, updatedAt: now() });
      return command;
    }
    const { id: _id, organizationId: _organizationId, createdAt: _createdAt, updatedAt: _updatedAt, ...values } = input;
    const [row] = await db.update(commands).set({ ...values, updatedAt: new Date() })
      .where(and(eq(commands.id, id), eq(commands.organizationId, MTI_ORGANIZATION_ID))).returning();
    return row ? commandRow(row) : null;
  },
  async reviseCommand(id: string, instruction: string, clarificationAnswer?: string) {
    const command = await repository.getCommand(id);
    if (!command) return null;
    if (db) {
      await db.insert(commandRevisions).values({
        commandId: id,
        instruction,
        clarificationAnswer: clarificationAnswer ?? null,
        context: command.context
      });
    }
    return repository.updateCommand(id, {
      instruction,
      status: "awaiting_confirmation",
      clarification: "Confirm the revised instruction before execution."
    });
  },
  async listMilestones(projectId: string) {
    if (!db) return store.milestones.filter((item) => item.projectId === projectId);
    return (await db.select().from(milestones).where(eq(milestones.projectId, projectId))
      .orderBy(asc(milestones.position), asc(milestones.createdAt))).map(milestoneRow);
  },
  async createMilestone(projectId: string, input: Pick<Milestone, "title" | "description" | "dueAt">) {
    if (!db) {
      const item: Milestone = {
        id: crypto.randomUUID(), projectId, status: "planned", position: store.milestones.length,
        createdAt: now(), updatedAt: now(), ...input
      };
      store.milestones.push(item);
      return item;
    }
    const [row] = await db.insert(milestones).values({
      projectId, title: input.title, description: input.description,
      dueAt: input.dueAt ? new Date(input.dueAt) : null
    }).returning();
    return milestoneRow(row);
  },
  async listProjectRecords(projectId: string) {
    if (!db) return store.projectRecords.filter((item) => item.projectId === projectId);
    return (await db.select().from(projectRecords).where(eq(projectRecords.projectId, projectId))
      .orderBy(desc(projectRecords.createdAt))).map(projectRecordRow);
  },
  async createProjectRecord(projectId: string, input: Pick<ProjectRecord, "agendaId" | "kind" | "content">) {
    if (!db) {
      const item: ProjectRecord = {
        id: crypto.randomUUID(), projectId, status: "open", sourceRunId: null,
        createdAt: now(), updatedAt: now(), ...input
      };
      store.projectRecords.unshift(item);
      return item;
    }
    const [row] = await db.insert(projectRecords).values({ projectId, ...input }).returning();
    return projectRecordRow(row);
  },
  async listDeliverables(projectId: string) {
    if (!db) return store.deliverables.filter((item) => item.projectId === projectId);
    return (await db.select().from(deliverables).where(eq(deliverables.projectId, projectId))
      .orderBy(desc(deliverables.createdAt))).map(deliverableRow);
  },
  async createDeliverable(projectId: string, input: Pick<Deliverable, "agendaId" | "title" | "type" | "reviewRequired">) {
    if (!db) {
      const item: Deliverable = {
        id: crypto.randomUUID(), projectId, runId: null, status: "planned",
        reportId: null, documentId: null, createdAt: now(), updatedAt: now(), ...input
      };
      store.deliverables.unshift(item);
      return item;
    }
    const [row] = await db.insert(deliverables).values({ projectId, ...input }).returning();
    return deliverableRow(row);
  },
  async listTasks(agendaId: string) {
    if (!db) return store.tasks.filter((item) => item.agendaId === agendaId);
    return (await db.select().from(tasks).where(eq(tasks.agendaId, agendaId))
      .orderBy(asc(tasks.createdAt))).map(taskRow);
  },
  async createTask(agendaId: string, input: Omit<WorkTask, "id" | "agendaId" | "status" | "createdAt" | "updatedAt">) {
    if (!db) {
      const item: WorkTask = {
        id: crypto.randomUUID(), agendaId, status: "queued",
        createdAt: now(), updatedAt: now(), ...input
      };
      store.tasks.push(item);
      return item;
    }
    const [row] = await db.insert(tasks).values({ agendaId, ...input }).returning();
    return taskRow(row);
  },
  async listAgentDefinitions() {
    if (!db) return store.agents;
    return (await db.select().from(agentDefinitions)
      .where(eq(agentDefinitions.organizationId, MTI_ORGANIZATION_ID))
      .orderBy(asc(agentDefinitions.role), asc(agentDefinitions.name))).map(agentRow);
  },
  async createRun(command: ExecutiveCommand) {
    if (!db) {
      const run: AgentRun = {
        id: crypto.randomUUID(), commandId: command.id, projectId: command.projectId,
        status: "queued", workflowRunId: null, progress: 0, createdAt: now(), updatedAt: now()
      };
      store.runs.unshift(run);
      store.events.push({
        id: crypto.randomUUID(), runId: run.id, sequence: 1,
        type: "run.queued", message: "Execution has been queued.", createdAt: now()
      });
      return run;
    }
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(runs).values({ commandId: command.id }).returning();
      await tx.insert(runEvents).values({
        runId: row.id, sequence: 1, type: "run.queued", message: "Execution has been queued."
      });
      return {
        id: row.id, commandId: row.commandId, projectId: command.projectId,
        status: row.status as AgentRun["status"], workflowRunId: row.triggerRunId,
        progress: row.progress, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt)
      };
    });
  },
  async recordModelCall(input: {
    runId: string;
    route: string;
    model?: string | null;
    provider?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    costMicros?: number;
    latencyMs?: number;
    fallbackReason?: string | null;
    licensingStatus?: string;
    environment?: string;
    attemptCount?: number;
    structuredOutputValid?: boolean | null;
    requestBudgetMicros?: number;
    error?: string | null;
  }) {
    if (!db) {
      const row = {
        id: crypto.randomUUID(),
        runId: input.runId,
        route: input.route,
        model: input.model ?? null,
        provider: input.provider ?? null,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        costMicros: input.costMicros ?? 0,
        latencyMs: input.latencyMs ?? 0,
        fallbackReason: input.fallbackReason ?? null,
        licensingStatus: input.licensingStatus ?? "unverified",
        environment: input.environment ?? "development",
        attemptCount: input.attemptCount ?? 1,
        structuredOutputValid: input.structuredOutputValid ?? null,
        requestBudgetMicros: input.requestBudgetMicros ?? null,
        error: input.error ?? null,
        projectId: null,
        userId: null,
        agentType: input.route.startsWith("executive") ? "executive" : "worker"
      };
      store.modelUsage.push(row);
      return row;
    }
    return db.transaction(async (tx) => {
      const costMicros = input.costMicros ?? 0;
      const [scope] = await tx.select({
        projectId: commands.projectId,
        userId: commands.createdBy
      }).from(runs).innerJoin(commands, eq(commands.id, runs.commandId))
        .where(eq(runs.id, input.runId)).limit(1);
      const [row] = await tx.insert(modelCalls).values({
        runId: input.runId,
        projectId: scope?.projectId ?? null,
        userId: scope?.userId ?? null,
        agentType: input.route.startsWith("executive") ? "executive" : "worker",
        route: input.route,
        model: input.model ?? null,
        provider: input.provider ?? null,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        costMicros,
        latencyMs: input.latencyMs ?? 0,
        fallbackReason: input.fallbackReason ?? null,
        licensingStatus: input.licensingStatus ?? "unverified",
        environment: input.environment ?? "development",
        attemptCount: input.attemptCount ?? 1,
        structuredOutputValid: input.structuredOutputValid ?? null,
        requestBudgetMicros: input.requestBudgetMicros ?? null,
        error: input.error ?? null
      }).returning();
      if (costMicros > 0) {
        await tx.update(runs).set({
          costMicros: drizzleSql`${runs.costMicros} + ${costMicros}`,
          updatedAt: new Date()
        }).where(eq(runs.id, input.runId));
        const run = await repository.getRun(input.runId);
        const scopes = [
          { scopeType: "run", scopeId: input.runId },
          run?.projectId ? { scopeType: "project", scopeId: run.projectId } : null
        ].filter((scope): scope is { scopeType: string; scopeId: string } => Boolean(scope));
        for (const scope of scopes) {
          await tx.update(budgetLedgers).set({
            spentCents: drizzleSql`${budgetLedgers.spentCents} + ${Math.ceil(costMicros / 10_000)}`,
            updatedAt: new Date()
          }).where(and(
            eq(budgetLedgers.organizationId, MTI_ORGANIZATION_ID),
            eq(budgetLedgers.scopeType, scope.scopeType),
            eq(budgetLedgers.scopeId, scope.scopeId)
          ));
        }
      }
      return row;
    });
  },
  /**
   * Total model spend charged to one run, in micros. `runs.cost_micros` is the
   * running total recordModelCall already maintains, so this reads the same
   * figure the budget ledger is derived from rather than a second tally that
   * could drift from it.
   */
  async getRunCostMicros(id: string): Promise<number> {
    if (!db) {
      return store.modelUsage
        .filter((call) => call.runId === id)
        .reduce((total, call) => total + call.costMicros, 0);
    }
    const [row] = await db.select({ costMicros: runs.costMicros })
      .from(runs).where(eq(runs.id, id)).limit(1);
    return row?.costMicros ?? 0;
  },

  async getRun(id: string) {
    if (!db) return store.runs.find((item) => item.id === id);
    const [row] = await db.select({
      run: runs,
      projectId: commands.projectId,
      organizationId: commands.organizationId
    }).from(runs).innerJoin(commands, eq(runs.commandId, commands.id)).where(eq(runs.id, id)).limit(1);
    if (!row || row.organizationId !== MTI_ORGANIZATION_ID) return undefined;
    return {
      id: row.run.id, commandId: row.run.commandId, projectId: row.projectId,
      status: row.run.status as AgentRun["status"], workflowRunId: row.run.triggerRunId,
      progress: row.run.progress, createdAt: iso(row.run.createdAt), updatedAt: iso(row.run.updatedAt)
    };
  },
  async updateRun(id: string, input: Partial<AgentRun>) {
    if (!db) {
      const run = store.runs.find((item) => item.id === id);
      if (!run) return null;
      Object.assign(run, input, { id, updatedAt: now() });
      return run;
    }
    const values: Partial<typeof runs.$inferInsert> = {};
    if (input.status) values.status = input.status;
    if (input.progress !== undefined) values.progress = input.progress;
    if (input.workflowRunId !== undefined) values.triggerRunId = input.workflowRunId;
    const [row] = await db.update(runs).set({ ...values, updatedAt: new Date() })
      .where(eq(runs.id, id)).returning();
    if (!row) return null;
    const command = await repository.getCommand(row.commandId);
    return {
      id: row.id, commandId: row.commandId, projectId: command?.projectId ?? null,
      status: row.status as AgentRun["status"], workflowRunId: row.triggerRunId,
      progress: row.progress, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt)
    };
  },
  async createReviewDecision(reviewId: string, input: Pick<ReviewDecision, "decision" | "note">, actorId = MTI_OPERATOR_ID) {
    const decision: ReviewDecision = { id: crypto.randomUUID(), reviewId, createdAt: now(), ...input };
    if (!db) {
      store.reviewDecisions.unshift(decision);
      return decision;
    }
    const [review] = await db.select().from(reviews).where(and(
      eq(reviews.id, reviewId),
      eq(reviews.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
    if (!review) return null;
    const [row] = await db.insert(reviewDecisionRows).values({
      id: decision.id,
      organizationId: MTI_ORGANIZATION_ID,
      reviewId,
      userId: actorId,
      decision: input.decision,
      note: input.note
    }).returning();
    await db.update(reviews).set({
      status: input.decision === "approved"
        ? "approved"
        : input.decision === "rejected" ? "rejected" : "revision",
      updatedAt: new Date()
    }).where(eq(reviews.id, reviewId));
    return {
      id: row.id,
      reviewId: row.reviewId,
      decision: row.decision as ReviewDecision["decision"],
      note: row.note,
      createdAt: iso(row.createdAt)
    };
  },
  async listReports() {
    if (!db) return store.reports;
    return (await db.select().from(reports).where(eq(reports.organizationId, MTI_ORGANIZATION_ID))
      .orderBy(desc(reports.updatedAt))).map(reportRow);
  },
  async getReport(id: string) {
    if (!db) return store.reports.find((item) => item.id === id);
    const [row] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    return row?.organizationId === MTI_ORGANIZATION_ID ? reportRow(row) : undefined;
  },
  async createReport(input: Pick<Report, "projectId" | "title" | "summary" | "content">, actorId = MTI_OPERATOR_ID) {
    if (!db) {
      const report: Report = {
        id: crypto.randomUUID(), status: "working", createdAt: now(), updatedAt: now(), ...input
      };
      store.reports.unshift(report);
      return report;
    }
    const [row] = await db.insert(reports).values({
      organizationId: MTI_ORGANIZATION_ID, createdBy: actorId, ...input
    }).returning();
    return reportRow(row);
  },
  async updateReport(id: string, input: Partial<Report>) {
    if (!db) {
      const report = store.reports.find((item) => item.id === id);
      if (!report) return null;
      Object.assign(report, input, { id, updatedAt: now() });
      return report;
    }
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...values } = input;
    const [row] = await db.update(reports).set({ ...values, updatedAt: new Date() })
      .where(and(eq(reports.id, id), eq(reports.organizationId, MTI_ORGANIZATION_ID))).returning();
    return row ? reportRow(row) : null;
  },
  async listKnowledge() {
    if (!db) return store.knowledge;
    return (await db.select().from(knowledgeEntries)
      .where(eq(knowledgeEntries.organizationId, MTI_ORGANIZATION_ID))
      .orderBy(desc(knowledgeEntries.createdAt))).map(knowledgeRow);
  },
  async createKnowledge(input: Omit<KnowledgeEntry, "id" | "status" | "createdAt">) {
    if (!db) {
      const entry: KnowledgeEntry = { id: crypto.randomUUID(), status: "proposed", createdAt: now(), ...input };
      store.knowledge.unshift(entry);
      return entry;
    }
    const [row] = await db.insert(knowledgeEntries).values({
      organizationId: MTI_ORGANIZATION_ID, ...input
    }).returning();
    return knowledgeRow(row);
  },
  async updateKnowledge(id: string, input: Partial<KnowledgeEntry>) {
    if (!db) {
      const entry = store.knowledge.find((item) => item.id === id);
      if (!entry) return null;
      Object.assign(entry, input, { id });
      return entry;
    }
    const { id: _id, createdAt: _createdAt, ...values } = input;
    const [row] = await db.update(knowledgeEntries).set(values)
      .where(and(
        eq(knowledgeEntries.id, id),
        eq(knowledgeEntries.organizationId, MTI_ORGANIZATION_ID)
      )).returning();
    return row ? knowledgeRow(row) : null;
  },
  async listClientDatabases() {
    if (!db) return store.clientDatabases;
    return (await db.select().from(clientDatabases)
      .where(eq(clientDatabases.organizationId, MTI_ORGANIZATION_ID))
      .orderBy(desc(clientDatabases.createdAt))).map(clientDatabaseRow);
  },
  async createClientDatabase(input: Pick<ClientDatabase, "name" | "description"> & { projectId?: string | null }) {
    if (!db) {
      const database: ClientDatabase = {
        id: crypto.randomUUID(), recordCount: 0, createdAt: now(),
        ...input, projectId: input.projectId ?? null
      };
      store.clientDatabases.unshift(database);
      return database;
    }
    const [row] = await db.insert(clientDatabases).values({
      organizationId: MTI_ORGANIZATION_ID, ...input, projectId: input.projectId ?? null
    }).returning();
    return clientDatabaseRow(row);
  },
  async updateClientDatabase(id: string, input: Partial<ClientDatabase>) {
    if (!db) {
      const database = store.clientDatabases.find((item) => item.id === id);
      if (!database) return null;
      Object.assign(database, input, { id });
      return database;
    }
    const { id: _id, recordCount: _recordCount, createdAt: _createdAt, ...values } = input;
    const [row] = await db.update(clientDatabases).set({ ...values, updatedAt: new Date() })
      .where(and(
        eq(clientDatabases.id, id),
        eq(clientDatabases.organizationId, MTI_ORGANIZATION_ID)
      )).returning();
    return row ? clientDatabaseRow(row) : null;
  },
  async listEvents(runId: string, after = 0) {
    if (!db) {
      return store.events
        .filter((event) => event.runId === runId && event.sequence > after)
        .sort((a, b) => a.sequence - b.sequence);
    }
    const rows = await db.select().from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.sequence, after)))
      .orderBy(asc(runEvents.sequence));
    return rows.map((event) => ({
      id: event.id, runId: event.runId, sequence: event.sequence,
      type: event.type, message: event.message, createdAt: iso(event.createdAt)
    }));
  },

  /** Appends the next event for a run. Sequence is derived so callers never collide. */
  async appendEvent(runId: string, input: Pick<RunEvent, "type" | "message">) {
    if (!db) {
      const last = store.events
        .filter((event) => event.runId === runId)
        .reduce((max, event) => Math.max(max, event.sequence), 0);
      const event: RunEvent = {
        id: crypto.randomUUID(), runId, sequence: last + 1,
        type: input.type, message: input.message, createdAt: now()
      };
      store.events.push(event);
      return event;
    }
    const row = await db.transaction(async (tx) => {
      await tx.execute(drizzleSql`select pg_advisory_xact_lock(hashtext(${runId}))`);
      const [{ value: last } = { value: 0 }] = await tx
        .select({ value: max(runEvents.sequence) })
        .from(runEvents)
        .where(eq(runEvents.runId, runId));
      const [inserted] = await tx.insert(runEvents).values({
        runId, sequence: (last ?? 0) + 1, type: input.type, message: input.message
      }).returning();
      return inserted;
    });
    return {
      id: row.id, runId: row.runId, sequence: row.sequence,
      type: row.type, message: row.message, createdAt: iso(row.createdAt)
    };
  },

  /** Runs belonging to a project, newest first — drives the project activity stream. */
  async listRunsForProject(projectId: string) {
    if (!db) {
      return store.runs
        .filter((run) => run.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const rows = await db.select({ run: runs, projectId: commands.projectId })
      .from(runs)
      .innerJoin(commands, eq(runs.commandId, commands.id))
      .where(and(eq(commands.projectId, projectId), eq(commands.organizationId, MTI_ORGANIZATION_ID)))
      .orderBy(desc(runs.createdAt));
    return rows.map((row) => ({
      id: row.run.id, commandId: row.run.commandId, projectId: row.projectId,
      status: row.run.status as AgentRun["status"], workflowRunId: row.run.triggerRunId,
      progress: row.run.progress, createdAt: iso(row.run.createdAt), updatedAt: iso(row.run.updatedAt)
    }));
  },

  /**
   * Runs started by one command, newest first.
   *
   * A command can own more than one run - a retried dispatch, or a campaign
   * continuation - so cancelling has to reach all of them rather than assuming
   * the newest is the only live one.
   */
  async listRunsForCommand(commandId: string) {
    if (!db) {
      return store.runs
        .filter((run) => run.commandId === commandId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const rows = await db.select({ run: runs, projectId: commands.projectId })
      .from(runs)
      .innerJoin(commands, eq(runs.commandId, commands.id))
      .where(and(eq(runs.commandId, commandId), eq(commands.organizationId, MTI_ORGANIZATION_ID)))
      .orderBy(desc(runs.createdAt));
    return rows.map((row) => ({
      id: row.run.id, commandId: row.run.commandId, projectId: row.projectId,
      status: row.run.status as AgentRun["status"], workflowRunId: row.run.triggerRunId,
      progress: row.run.progress, createdAt: iso(row.run.createdAt), updatedAt: iso(row.run.updatedAt)
    }));
  },

  /**
   * Flattened, chronologically ordered event feed across every run in a project.
   * `after` is an ISO timestamp cursor so the caller can poll for only what is new.
   */
  async listProjectEvents(projectId: string, after?: string): Promise<ProjectActivityEvent[]> {
    const projectRuns = await repository.listRunsForProject(projectId);
    if (projectRuns.length === 0) return [];
    const perRun = await Promise.all(
      projectRuns.map(async (run) => {
        const events = await repository.listEvents(run.id);
        return events.map((event) => ({ ...event, runStatus: run.status }));
      })
    );
    return perRun
      .flat()
      .filter((event) => (after ? event.createdAt > after : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sequence - b.sequence);
  },

  async listFolders(): Promise<DocumentFolder[]> {
    if (!db) {
      return store.folders.map((folder) => ({
        ...folder,
        documentCount: store.documents.filter((item) => item.folderId === folder.id).length
      }));
    }
    await ensureDefaultFolders();
    const rows = await db.select().from(documentFolders)
      .where(eq(documentFolders.organizationId, MTI_ORGANIZATION_ID))
      .orderBy(asc(documentFolders.position), asc(documentFolders.createdAt));
    const counts = await db.select({ folderId: documents.folderId, value: count() })
      .from(documents)
      .where(eq(documents.organizationId, MTI_ORGANIZATION_ID))
      .groupBy(documents.folderId);
    const byFolder = new Map(counts.map((row) => [row.folderId, Number(row.value)]));
    return rows.map((row) => ({
      id: row.id, name: row.name, system: row.system,
      documentCount: byFolder.get(row.id) ?? 0, createdAt: iso(row.createdAt)
    }));
  },

  async createFolder(name: string): Promise<DocumentFolder> {
    if (!db) {
      const existing = store.folders.find((folder) => folder.name.toLowerCase() === name.toLowerCase());
      if (existing) return { ...existing, documentCount: 0 };
      const folder = { id: crypto.randomUUID(), name, system: false, createdAt: now() };
      store.folders.push(folder);
      return { ...folder, documentCount: 0 };
    }
    const [row] = await db.insert(documentFolders)
      .values({ organizationId: MTI_ORGANIZATION_ID, name, position: 100 })
      .onConflictDoNothing()
      .returning();
    if (row) {
      return { id: row.id, name: row.name, system: row.system, documentCount: 0, createdAt: iso(row.createdAt) };
    }
    const folders = await repository.listFolders();
    const existing = folders.find((folder) => folder.name.toLowerCase() === name.toLowerCase());
    if (!existing) throw new Error("Could not create folder.");
    return existing;
  },

  /** Never selects `markdown` — document bodies must not ride along in list payloads. */
  async listDocuments(): Promise<WorkspaceDocument[]> {
    if (!db) return store.documents.map(stripMarkdown).sort(byUpdatedDesc);
    const rows = await db.select(DOCUMENT_COLUMNS).from(documents)
      .where(eq(documents.organizationId, MTI_ORGANIZATION_ID))
      .orderBy(desc(documents.updatedAt));
    return rows.map(documentSummaryRow);
  },

  async getDocument(id: string): Promise<WorkspaceDocumentDetail | undefined> {
    if (!db) return store.documents.find((item) => item.id === id);
    const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!row || row.organizationId !== MTI_ORGANIZATION_ID) return undefined;
    return { ...documentRow(row), markdown: row.markdown };
  },

  async createDocument(
    input: Omit<WorkspaceDocumentDetail, "id" | "createdAt" | "updatedAt" | "aiGenerated"> & { aiGenerated?: boolean }
  ): Promise<WorkspaceDocumentDetail> {
    if (!db) {
      const document: StoredDocument = {
        id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), aiGenerated: false, ...input
      };
      store.documents.unshift(document);
      return document;
    }
    const [row] = await db.insert(documents)
      .values({ organizationId: MTI_ORGANIZATION_ID, aiGenerated: false, ...input })
      .returning();
    return { ...documentRow(row), markdown: row.markdown };
  },

  async updateDocument(
    id: string,
    input: Partial<Pick<
      WorkspaceDocumentDetail,
      "folderId" | "title" | "projectId" | "markdown" | "pageCount" |
      "wordCount" | "sourceKind" | "storageKey"
    >>
  ) {
    // Body edits change the word count, so recompute it rather than letting the
    // stored figure drift away from the content.
    const values = input.markdown === undefined
      ? input
      : { ...input, wordCount: (input.markdown.trim().match(/\S+/g) ?? []).length };

    if (!db) {
      const document = store.documents.find((item) => item.id === id);
      if (!document) return null;
      Object.assign(document, values, { id, updatedAt: now() });
      return stripMarkdown(document);
    }
    const [row] = await db.update(documents).set({ ...values, updatedAt: new Date() })
      .where(and(eq(documents.id, id), eq(documents.organizationId, MTI_ORGANIZATION_ID)))
      .returning();
    return row ? documentRow(row) : null;
  },

  async listRecords(databaseId: string): Promise<ClientRecord[]> {
    if (!db) {
      return store.records
        .filter((record) => record.databaseId === databaseId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const rows = await db.select().from(clientRecords)
      .where(eq(clientRecords.databaseId, databaseId))
      .orderBy(desc(clientRecords.createdAt));
    return rows.map((row) => ({
      id: row.id, databaseId: row.databaseId,
      data: row.data as Record<string, string>, createdAt: iso(row.createdAt)
    }));
  },

  async createRecords(databaseId: string, rows: Array<Record<string, string>>): Promise<ClientRecord[]> {
    if (rows.length === 0) return [];
    if (!db) {
      const created = rows.map((data) => ({
        id: crypto.randomUUID(), databaseId, data, createdAt: now()
      }));
      store.records.push(...created);
      return created;
    }
    const inserted = await db.insert(clientRecords)
      .values(rows.map((data) => ({ databaseId, data })))
      .returning();
    return inserted.map((row) => ({
      id: row.id, databaseId: row.databaseId,
      data: row.data as Record<string, string>, createdAt: iso(row.createdAt)
    }));
  },

  async getRecord(databaseId: string, id: string): Promise<ClientRecord | null> {
    if (!db) {
      return store.records.find((record) => record.databaseId === databaseId && record.id === id) ?? null;
    }
    const [row] = await db.select({ record: clientRecords })
      .from(clientRecords)
      .innerJoin(clientDatabases, eq(clientDatabases.id, clientRecords.databaseId))
      .where(and(
        eq(clientRecords.id, id),
        eq(clientRecords.databaseId, databaseId),
        eq(clientDatabases.organizationId, MTI_ORGANIZATION_ID)
      )).limit(1);
    return row ? {
      id: row.record.id,
      databaseId: row.record.databaseId,
      data: row.record.data as Record<string, string>,
      createdAt: iso(row.record.createdAt)
    } : null;
  },

  async putRecord(databaseId: string, id: string, data: Record<string, string>): Promise<ClientRecord> {
    if (!db) {
      const existing = store.records.find((record) => record.databaseId === databaseId && record.id === id);
      if (existing) {
        existing.data = data;
        return existing;
      }
      const record = { id, databaseId, data, createdAt: now() };
      store.records.push(record);
      return record;
    }
    const databases = await db.select({ id: clientDatabases.id }).from(clientDatabases).where(and(
      eq(clientDatabases.id, databaseId),
      eq(clientDatabases.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
    if (databases.length === 0) throw new Error("Client database not found.");
    const [row] = await db.insert(clientRecords).values({
      id,
      databaseId,
      data,
      fingerprint: createHash("sha256").update(JSON.stringify(data)).digest("hex")
    }).onConflictDoUpdate({
      target: clientRecords.id,
      set: {
        data,
        fingerprint: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
        updatedAt: new Date()
      }
    }).returning();
    return {
      id: row.id,
      databaseId: row.databaseId,
      data: row.data as Record<string, string>,
      createdAt: iso(row.createdAt)
    };
  },

  async deleteRecordScoped(databaseId: string, id: string) {
    if (!db) {
      const index = store.records.findIndex((record) =>
        record.databaseId === databaseId && record.id === id
      );
      if (index === -1) return false;
      store.records.splice(index, 1);
      return true;
    }
    const owned = await db.select({ id: clientDatabases.id }).from(clientDatabases).where(and(
      eq(clientDatabases.id, databaseId),
      eq(clientDatabases.organizationId, MTI_ORGANIZATION_ID)
    )).limit(1);
    if (owned.length === 0) return false;
    const rows = await db.delete(clientRecords).where(and(
      eq(clientRecords.id, id),
      eq(clientRecords.databaseId, databaseId)
    )).returning({ id: clientRecords.id });
    return rows.length > 0;
  },

  async deleteRecord(id: string) {
    if (!db) {
      const index = store.records.findIndex((record) => record.id === id);
      if (index === -1) return false;
      store.records.splice(index, 1);
      return true;
    }
    const rows = await db.delete(clientRecords).where(eq(clientRecords.id, id)).returning({ id: clientRecords.id });
    return rows.length > 0;
  },

  async deleteClientDatabase(id: string) {
    if (!db) {
      const index = store.clientDatabases.findIndex((item) => item.id === id);
      if (index === -1) return false;
      store.clientDatabases.splice(index, 1);
      store.records = store.records.filter((record) => record.databaseId !== id);
      return true;
    }
    const rows = await db.delete(clientDatabases)
      .where(and(eq(clientDatabases.id, id), eq(clientDatabases.organizationId, MTI_ORGANIZATION_ID)))
      .returning({ id: clientDatabases.id });
    return rows.length > 0;
  },

  async deleteKnowledge(id: string) {
    if (!db) {
      const index = store.knowledge.findIndex((entry) => entry.id === id);
      if (index === -1) return false;
      store.knowledge.splice(index, 1);
      return true;
    }
    const rows = await db.delete(knowledgeEntries)
      .where(and(eq(knowledgeEntries.id, id), eq(knowledgeEntries.organizationId, MTI_ORGANIZATION_ID)))
      .returning({ id: knowledgeEntries.id });
    return rows.length > 0;
  },

  async deleteDocument(id: string) {
    if (!db) {
      const index = store.documents.findIndex((item) => item.id === id);
      if (index === -1) return false;
      store.documents.splice(index, 1);
      return true;
    }
    const rows = await db.delete(documents)
      .where(and(eq(documents.id, id), eq(documents.organizationId, MTI_ORGANIZATION_ID)))
      .returning({ id: documents.id });
    return rows.length > 0;
  }
};

/** Column set for list reads — everything except the markdown body. */
const DOCUMENT_COLUMNS = {
  id: documents.id,
  folderId: documents.folderId,
  projectId: documents.projectId,
  title: documents.title,
  filename: documents.filename,
  mimeType: documents.mimeType,
  sourceKind: documents.sourceKind,
  aiGenerated: documents.aiGenerated,
  sizeBytes: documents.sizeBytes,
  pageCount: documents.pageCount,
  wordCount: documents.wordCount,
  storageKey: documents.storageKey,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt
} as const;

type DocumentSummaryRow = {
  [K in keyof typeof DOCUMENT_COLUMNS]: (typeof documents.$inferSelect)[K];
};

const documentSummaryRow = (row: DocumentSummaryRow): WorkspaceDocument => ({
  ...row,
  sourceKind: row.sourceKind as WorkspaceDocument["sourceKind"],
  aiGenerated: row.aiGenerated,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const documentRow = (row: typeof documents.$inferSelect): WorkspaceDocument => ({
  id: row.id,
  folderId: row.folderId,
  projectId: row.projectId,
  title: row.title,
  filename: row.filename,
  mimeType: row.mimeType,
  sourceKind: row.sourceKind as WorkspaceDocument["sourceKind"],
  aiGenerated: row.aiGenerated,
  sizeBytes: row.sizeBytes,
  pageCount: row.pageCount,
  wordCount: row.wordCount,
  storageKey: row.storageKey,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const stripMarkdown = ({ markdown: _markdown, ...rest }: StoredDocument): WorkspaceDocument => rest;
const byUpdatedDesc = (a: WorkspaceDocument, b: WorkspaceDocument) => b.updatedAt.localeCompare(a.updatedAt);

/** The default folder set is created on first read so a fresh database is never empty. */
async function ensureDefaultFolders() {
  if (!db) return;
  const [existing] = await db.select({ value: count() }).from(documentFolders)
    .where(eq(documentFolders.organizationId, MTI_ORGANIZATION_ID));
  if (Number(existing?.value ?? 0) > 0) return;
  await db.insert(documentFolders).values(
    DEFAULT_FOLDERS.map((name, index) => ({
      organizationId: MTI_ORGANIZATION_ID, name, system: index === 0, position: index
    }))
  ).onConflictDoNothing();
}
