import { NextResponse } from "next/server";
import { listProjectClientChangeSets } from "@/lib/client-changes";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  return NextResponse.json({ data: await listProjectClientChangeSets(projectId) });
}
