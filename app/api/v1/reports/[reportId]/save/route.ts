import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";

export async function POST(_: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const report = await repository.updateReport(reportId, { status: "saved" });
  if (!report) return notFound("report");
  return NextResponse.json({ data: report, destination: "saved-reports" });
}
