import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { dispatchResearchProject } from "@/lib/workflows/trigger";

export const POST = guard<{ projectId: string }>(async (_request, { params }) => {
  return NextResponse.json({ data: await dispatchResearchProject(params.projectId) }, { status: 202 });
}, { rateLimit: "expensive" });
