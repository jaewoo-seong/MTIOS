import { describe, expect, it } from "vitest";
import { repository } from "@/lib/repository";

describe("development repository lifecycle", () => {
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
});
