import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
export const GET = guard<{ runId: string }>(async (_request, { params }) => {
  const { runId } = params;
  const run = await repository.getRun(runId);
  if (!run) return notFound("run");
  return NextResponse.json({ data: run });
});
