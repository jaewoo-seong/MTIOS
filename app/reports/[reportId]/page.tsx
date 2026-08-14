import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { currentSession } from "@/lib/auth";
import { requireDatabase } from "@/lib/db/client";
import { reportSources, reports } from "@/lib/db/schema";

export default async function ReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const session = await currentSession();
  const { reportId } = await params;
  const db = requireDatabase();
  const [report] = await db.select().from(reports).where(and(
    eq(reports.id, reportId),
    eq(reports.organizationId, session.organizationId)
  )).limit(1);
  if (!report) notFound();
  const sources = await db.select().from(reportSources).where(and(
    eq(reportSources.reportId, report.id),
    eq(reportSources.organizationId, session.organizationId)
  ));
  return (
    <main className="report-review-page">
      <nav><Link href="/">← Back to Business OS</Link></nav>
      <header>
        <span className="eyebrow">Cross-project report · {report.status}</span>
        <h1>{report.title}</h1>
        <p>{report.summary}</p>
        <small>{sources.length} approved source revision{sources.length === 1 ? "" : "s"}</small>
      </header>
      <article><pre>{report.content}</pre></article>
    </main>
  );
}
