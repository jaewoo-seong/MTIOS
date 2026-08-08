import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { getResearchWorkspace } from "@/lib/research-workspace";
import { repository } from "@/lib/repository";

export const GET = guard<{ projectId: string }>(async (_request, { params }) => {
  if (!await repository.getProject(params.projectId)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  return NextResponse.json({ data: await getResearchWorkspace(params.projectId) });
});
