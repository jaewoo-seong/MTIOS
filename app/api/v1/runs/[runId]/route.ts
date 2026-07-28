import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await repository.getRun(runId);
  if (!run) return notFound("run");
  return NextResponse.json({ data: run });
}
