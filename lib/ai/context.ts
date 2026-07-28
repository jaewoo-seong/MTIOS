import { repository } from "@/lib/repository";

export async function buildAgentContext(projectId: string | null) {
  const approvedKnowledge = (await repository.listKnowledge())
    .filter((entry) => entry.status === "approved")
    .slice(0, 30);

  if (!projectId) {
    return {
      project: null,
      agendas: [],
      reports: [],
      approvedKnowledge
    };
  }

  const [project, agendas, reports] = await Promise.all([
    repository.getProject(projectId),
    repository.listAgendas(projectId),
    repository.listReports()
  ]);

  return {
    project: project ?? null,
    agendas: agendas.slice(0, 50),
    reports: reports.filter((report) => report.projectId === projectId).slice(0, 20),
    approvedKnowledge
  };
}
