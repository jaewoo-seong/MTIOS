import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { repository } from "@/lib/repository";

describe("development repository lifecycle", () => {
  it("converts legacy task assignments before adding the agent UUID foreign key", async () => {
    const migration = await readFile(
      new URL("../drizzle/0002_lyrical_pete_wisdom.sql", import.meta.url),
      "utf8"
    );

    expect(migration).toContain('ALTER COLUMN "assigned_agent_id" SET DATA TYPE uuid');
    expect(migration.indexOf("SET DATA TYPE uuid")).toBeLessThan(
      migration.indexOf('ADD CONSTRAINT "tasks_assigned_agent_id_agent_definitions_id_fk"')
    );
  });

  it("enables pgcrypto before hashing document backfill content", async () => {
    const migration = await readFile(
      new URL("../drizzle/0011_sweet_gabe_jones.sql", import.meta.url),
      "utf8"
    );

    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    expect(migration.indexOf("CREATE EXTENSION IF NOT EXISTS pgcrypto")).toBeLessThan(
      migration.indexOf("digest(")
    );
  });

  it("keeps a long-lived project, agenda, command, run, and report connected", async () => {
    const project = await repository.createProject({
      name: "Lifecycle verification",
      objective: "Verify durable object relationships",
      context: "",
      scope: "",
      constraints: [],
      budgetCents: null
    });
    const agenda = await repository.createAgenda(project.id, {
      title: "Initial agenda",
      instruction: "Verify the complete project execution lifecycle and preserve its output."
    });
    const command = await repository.createCommand({
      page: "projects",
      projectId: project.id,
      instruction: "Execute the initial agenda and create a structured report for review."
    });
    const run = await repository.createRun(command);
    const report = await repository.createReport({
      projectId: project.id,
      title: "Lifecycle report",
      summary: "",
      content: ""
    });

    expect(agenda.projectId).toBe(project.id);
    expect(command.projectId).toBe(project.id);
    expect(run.commandId).toBe(command.id);
    expect(report.projectId).toBe(project.id);
    expect((await repository.listEvents(run.id))[0]?.type).toBe("run.queued");
  });

  it("requires clarification for underspecified commands", async () => {
    const command = await repository.createCommand({
      page: "agent",
      projectId: null,
      instruction: "Research this"
    });
    expect(command.status).toBe("needs_clarification");
    expect(command.clarification).toBeTruthy();
  });

  it("persists project governance, typed agendas, and attached command context", async () => {
    const project = await repository.createProject({
      name: "Cross-functional program",
      objective: "Coordinate research, marketing, and document work in one durable project.",
      context: "The work continues across several quarterly agendas.",
      scope: "Internal planning and approved client deliverables.",
      constraints: ["No external sends without approval"],
      budgetCents: 50000,
      reviewGates: ["Approve client-facing outputs"],
      outputRequirements: ["Executive summary", "Source register"],
      permissions: {
        externalSend: "review_required",
        clientDataWrite: "review_required",
        destructiveAction: "blocked"
      }
    });
    const agenda = await repository.createAgenda(project.id, {
      title: "Develop campaign options",
      instruction: "Develop three campaign options using approved project context.",
      workType: "marketing"
    });
    const command = await repository.createCommand({
      page: "projects",
      projectId: project.id,
      instruction: "Develop three campaign options and return a decision memo for review.",
      context: {
        page: "projects",
        projectId: project.id,
        selectedRecordIds: ["00000000-0000-4000-8000-000000000099"]
      }
    });

    expect(project.reviewGates).toEqual(["Approve client-facing outputs"]);
    expect(project.permissions.destructiveAction).toBe("blocked");
    expect(agenda.workType).toBe("marketing");
    expect(command.context.projectId).toBe(project.id);
    expect(command.context.selectedRecordIds).toHaveLength(1);
  });

  it("keeps milestones, project records, deliverables, and tasks traceable", async () => {
    const project = await repository.createProject({
      name: "Traceability program",
      objective: "Verify that planning records remain connected to their originating project.",
      context: "",
      scope: "",
      constraints: [],
      budgetCents: null
    });
    const agenda = await repository.createAgenda(project.id, {
      title: "Prepare operating memo",
      instruction: "Prepare an operating memo with explicit assumptions and review requirements.",
      workType: "document"
    });
    const milestone = await repository.createMilestone(project.id, {
      title: "Draft ready",
      description: "Initial draft is ready for review.",
      dueAt: null
    });
    const record = await repository.createProjectRecord(project.id, {
      agendaId: agenda.id,
      kind: "assumption",
      content: "The source package is complete."
    });
    const deliverable = await repository.createDeliverable(project.id, {
      agendaId: agenda.id,
      title: "Operating memo",
      type: "report",
      reviewRequired: true
    });
    const task = await repository.createTask(agenda.id, {
      title: "Draft memo",
      description: "Draft the structured memo.",
      assignedAgentId: null,
      dependsOn: [],
      toolScopes: ["project:read"],
      outputSchema: { type: "object" },
      budgetCents: 1000,
      reviewRequired: true
    });

    expect(milestone.projectId).toBe(project.id);
    expect(record.agendaId).toBe(agenda.id);
    expect(deliverable.reviewRequired).toBe(true);
    expect(task.agendaId).toBe(agenda.id);
    expect(task.toolScopes).toEqual(["project:read"]);
  });
});
