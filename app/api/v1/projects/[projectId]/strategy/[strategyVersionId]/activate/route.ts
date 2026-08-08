import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { activateResearchStrategy } from "@/lib/research-workspace";
import { dispatchResearchDiscovery, dispatchResearchProject } from "@/lib/workflows/trigger";

export const POST = guard<{ projectId: string; strategyVersionId: string }>(async (_request, { params, session }) => {
  const strategy = await activateResearchStrategy(params.projectId, params.strategyVersionId, session.userId);
  if (!strategy) return NextResponse.json({ error: "Strategy proposal not found." }, { status: 404 });
  const [discovery, dossiers] = await Promise.all([
    dispatchResearchDiscovery(params.projectId),
    dispatchResearchProject(params.projectId)
  ]);
  return NextResponse.json({ data: { strategy, dispatch: { discovery, dossiers } } });
});
