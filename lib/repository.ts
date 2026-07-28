import { and, desc, eq } from "drizzle-orm";
import type {
  Agenda,
  AgentRun,
  ClientDatabase,
  ExecutiveCommand,
  KnowledgeEntry,
  Project,
  Report,
  ReviewDecision,
  RunEvent
} from "@/lib/domain";
import { db } from "@/lib/db/client";
import {
  agendas,
  clientDatabases,
  commands,
  knowledgeEntries,
  projects,
  reports,
  runEvents,
  runs
} from "@/lib/db/schema";

export const MTI_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
export const MTI_OPERATOR_ID = "00000000-0000-4000-8000-000000000002";

type Store = {
  projects: Project[];
  agendas: Agenda[];
  commands: ExecutiveCommand[];
  reports: Report[];
  knowledge: KnowledgeEntry[];
  clientDatabases: ClientDatabase[];
  events: RunEvent[];
  runs: AgentRun[];
  reviewDecisions: ReviewDecision[];
};

const globalStore = globalThis as typeof globalThis & { __businessOsStore?: Store };
const store: Store = globalStore.__businessOsStore ?? {
  projects: [],
  agendas: [],
  commands: [],
  reports: [],
  knowledge: [],
  clientDatabases: [],
  events: [],
  runs: [],
  reviewDecisions: []
};
globalStore.__businessOsStore = store;

const now = () => new Date().toISOString();
const iso = (date: Date) => date.toISOString();

const projectRow = (row: typeof projects.$inferSelect): Project => ({
  ...row,
  constraints: row.constraints ?? [],
  budgetCents: row.budgetCents ?? null,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt)
});

const agendaRow = (row: typeof agendas.$inferSelect): Agenda => ({
  id: row.id,
  projectId: row.projectId,
  title: row.title,
  instruction: row.instruction,
  status: row.status,
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
  async createProject(input: Omit<Project, "id" | "organizationId" | "status" | "createdAt" | "updatedAt">) {
    if (!db) {
      const project: Project = {
        id: crypto.randomUUID(),
        organizationId: MTI_ORGANIZATION_ID,
        status: "active",
        createdAt: now(),
        updatedAt: now(),
        ...input
      };
      store.projects.unshift(project);
      return project;
    }
    const [row] = await db.insert(projects).values({
      organizationId: MTI_ORGANIZATION_ID,
      ownerId: MTI_OPERATOR_ID,
      ...input
    }).returning();
    return projectRow(row);
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
  async createAgenda(projectId: string, input: Pick<Agenda, "title" | "instruction">) {
    if (!db) {
      const agenda: Agenda = {
        id: crypto.randomUUID(), projectId, status: "queued",
        createdAt: now(), updatedAt: now(), ...input
      };
      store.agendas.unshift(agenda);
      return agenda;
    }
    const [row] = await db.insert(agendas).values({ projectId, ...input }).returning();
    return agendaRow(row);
  },
  async createCommand(input: Pick<ExecutiveCommand, "page" | "projectId" | "instruction">) {
    const needsClarification = input.instruction.trim().split(/\s+/).length < 8;
    const status = needsClarification ? "needs_clarification" : "awaiting_confirmation";
    const clarification = needsClarification
      ? "What outcome should be produced, and which project or records should this instruction affect?"
      : "Confirm the scope and review gates before execution.";
    if (!db) {
      const command: ExecutiveCommand = {
        id: crypto.randomUUID(), organizationId: MTI_ORGANIZATION_ID,
        ...input, status, clarification, createdAt: now(), updatedAt: now()
      };
      store.commands.unshift(command);
      return command;
    }
    const [row] = await db.insert(commands).values({
      organizationId: MTI_ORGANIZATION_ID, ...input, status, clarification
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
  async createReviewDecision(reviewId: string, input: Pick<ReviewDecision, "decision" | "note">) {
    const decision: ReviewDecision = { id: crypto.randomUUID(), reviewId, createdAt: now(), ...input };
    store.reviewDecisions.unshift(decision);
    return decision;
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
  async createReport(input: Pick<Report, "projectId" | "title" | "summary" | "content">) {
    if (!db) {
      const report: Report = {
        id: crypto.randomUUID(), status: "working", createdAt: now(), updatedAt: now(), ...input
      };
      store.reports.unshift(report);
      return report;
    }
    const [row] = await db.insert(reports).values({
      organizationId: MTI_ORGANIZATION_ID, ...input
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
  async createClientDatabase(input: Pick<ClientDatabase, "name" | "description">) {
    if (!db) {
      const database: ClientDatabase = { id: crypto.randomUUID(), recordCount: 0, createdAt: now(), ...input };
      store.clientDatabases.unshift(database);
      return database;
    }
    const [row] = await db.insert(clientDatabases).values({
      organizationId: MTI_ORGANIZATION_ID, ...input
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
    if (!db) return store.events.filter((event) => event.runId === runId && event.sequence > after);
    const rows = await db.select().from(runEvents).where(eq(runEvents.runId, runId));
    return rows.filter((event) => event.sequence > after).map((event) => ({
      id: event.id, runId: event.runId, sequence: event.sequence,
      type: event.type, message: event.message, createdAt: iso(event.createdAt)
    }));
  }
};
