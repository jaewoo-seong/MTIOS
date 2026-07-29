import { repository } from "@/lib/repository";
import { buildContextPack } from "@/lib/context/retrieval";

export async function buildAgentContext(
  projectId: string | null,
  query: string,
  metadata: { commandId?: string | null; runId?: string | null; agendaId?: string | null; taskId?: string | null } = {}
) {
  const pack = await buildContextPack({
    query,
    projectId,
    commandId: metadata.commandId,
    runId: metadata.runId,
    agendaId: metadata.agendaId,
    taskId: metadata.taskId
  });

  if (!projectId) {
    return {
      project: null,
      contextPack: pack
    };
  }

  const project = await repository.getProject(projectId);

  return {
    project: project ?? null,
    contextPack: pack
  };
}
