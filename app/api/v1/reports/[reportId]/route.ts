import { NextResponse } from "next/server";
import { z } from "zod";
import { notFound, parseJson } from "@/lib/http";
import { repository } from "@/lib/repository";

import { guard } from "@/lib/api/guard";
import { and, eq } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/client";
import { reportProjects, reportSources, reports } from "@/lib/db/schema";
import { queueReportReadyNotification } from "@/lib/notifications";
import { dispatchNotificationDelivery } from "@/lib/workflows/trigger";
import { reportError } from "@/lib/observability/logger";
const schema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  summary: z.string().max(4000).optional(),
  content: z.string().max(100000).optional(),
  status: z.enum(["working", "review", "saved"]).optional()
});

export const GET = guard<{ reportId: string }>(async (_request, { session, params }) => {
  const db = requireDatabase();
  const [report] = await db.select().from(reports).where(and(
    eq(reports.id, params.reportId),
    eq(reports.organizationId, session.organizationId)
  )).limit(1);
  if (!report) return notFound("report");
  const [projects, sources] = await Promise.all([
    db.select().from(reportProjects).where(and(
      eq(reportProjects.reportId, report.id),
      eq(reportProjects.organizationId, session.organizationId)
    )),
    db.select().from(reportSources).where(and(
      eq(reportSources.reportId, report.id),
      eq(reportSources.organizationId, session.organizationId)
    ))
  ]);
  return NextResponse.json({ data: { report, projectIds: projects.map((row) => row.projectId), sources } });
});

export const PATCH = guard<{ reportId: string }>(async (request, { params }) => {
  const { reportId } = params;
  const parsed = await parseJson(request, schema);
  if (parsed.error) return parsed.error;
  const report = await repository.updateReport(reportId, parsed.data);
  if (!report) return notFound("report");
  if (parsed.data.status === "review") {
    try {
      const notification = await queueReportReadyNotification(reportId);
      if (notification.queued) await dispatchNotificationDelivery(notification.id);
    } catch (error) {
      reportError("notification.dispatch_failed", error, { reportId });
    }
  }
  return NextResponse.json({ data: report });
});
