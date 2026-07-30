import { NextResponse } from "next/server";
import { listProjectClientChangeSets } from "@/lib/client-changes";

import { guard } from "@/lib/api/guard";
export const GET = guard<{ projectId: string }>(async (_request, { params }) => {
  const { projectId } = params;
  return NextResponse.json({ data: await listProjectClientChangeSets(projectId) });
});
