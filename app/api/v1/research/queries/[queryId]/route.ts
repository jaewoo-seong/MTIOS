import { NextResponse } from "next/server";
import { getResearchQueryStatus } from "@/lib/research/engine";

import { guard } from "@/lib/api/guard";
export const GET = guard<{ queryId: string }>(async (_request, { params }) => {
  const { queryId } = params;
  const result = await getResearchQueryStatus(queryId);
  return result
    ? NextResponse.json({ data: result })
    : NextResponse.json({ error: "Research query not found." }, { status: 404 });
});
