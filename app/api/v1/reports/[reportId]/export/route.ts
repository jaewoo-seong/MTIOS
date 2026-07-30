import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";
import { storeReportExport } from "@/lib/storage";

import { guard } from "@/lib/api/guard";
export const POST = guard<{ reportId: string }>(async (_request, { params }) => {
  const { reportId } = params;
  const report = await repository.getReport(reportId);
  if (!report) return notFound("report");
  const artifact = await storeReportExport(
    report.id,
    report.title,
    `# ${report.title}\n\n## Executive summary\n\n${report.summary}\n\n## Report\n\n${report.content}`
  );
  return NextResponse.json({
    data: { status: "completed", ...artifact }
  }, { status: 201 });
});
