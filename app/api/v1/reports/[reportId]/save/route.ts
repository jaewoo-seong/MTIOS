import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
export const POST = guard<{ reportId: string }>(async (_request, { params }) => {
  const { reportId } = params;
  const report = await repository.updateReport(reportId, { status: "saved" });
  if (!report) return notFound("report");
  return NextResponse.json({ data: report, destination: "saved-reports" });
});
