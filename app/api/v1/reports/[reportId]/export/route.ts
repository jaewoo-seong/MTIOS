import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";
import { storeReportExport } from "@/lib/storage";

export async function POST(_: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
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
}
