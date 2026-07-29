import { NextResponse } from "next/server";
import { getResearchQueryStatus } from "@/lib/research/engine";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ queryId: string }> }
) {
  const { queryId } = await params;
  const result = await getResearchQueryStatus(queryId);
  return result
    ? NextResponse.json({ data: result })
    : NextResponse.json({ error: "Research query not found." }, { status: 404 });
}
