import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { createClientChangeSet, submitClientChangeSet } from "@/lib/client-changes";
import { ingestDocument } from "@/lib/documents/intelligence";
import { repository } from "@/lib/repository";
import {
  buildChangeSetItems,
  ImportError,
  partitionImportFiles,
  planResearchImport
} from "@/lib/research-import";

export const dynamic = "force-dynamic";

/** Markdown is text, so this ceiling is generous per file and still bounds the request. */
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/**
 * Imports an external research set: one CSV of entities plus one Markdown
 * report each, linked so every row opens its own report.
 *
 * Two properties this route is built around:
 *
 * Nothing enters client data directly. `POST /client-databases/:id/records`
 * returns 405 by design, so rows are staged as a single change set and left
 * awaiting review. This route never approves.
 *
 * Nothing is written until everything validates. The CSV is checked against
 * the supplied filenames first, so a report missing at row 87 fails the
 * request instead of leaving 86 orphaned documents behind.
 *
 * Markdown only, deliberately: PDF and DOCX would route through the
 * conversion service, a paid CPU-bound OCR call per file, which a
 * hundred-report import is the worst place to spend.
 */
export const POST = guard(async (request) => {
  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "validation_error", detail: "Expected a multipart upload." }, { status: 400 });
  }

  const projectId = String(form.get("projectId") ?? "");
  const databaseId = String(form.get("databaseId") ?? "");
  if (!projectId || !databaseId) {
    return NextResponse.json(
      { error: "validation_error", detail: "projectId and databaseId are required." },
      { status: 400 }
    );
  }

  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "validation_error", detail: "Attach the CSV and its reports." }, { status: 400 });
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      { error: "payload_too_large", detail: `Upload is ${Math.round(total / 1024 / 1024)}MB; the limit is ${MAX_TOTAL_BYTES / 1024 / 1024}MB.` },
      { status: 413 }
    );
  }
  const oversize = files.find((file) => file.size > MAX_REPORT_BYTES);
  if (oversize) {
    return NextResponse.json(
      { error: "payload_too_large", detail: `"${oversize.name}" exceeds the ${MAX_REPORT_BYTES / 1024 / 1024}MB per-file limit.` },
      { status: 413 }
    );
  }
  const empty = files.find((file) => file.size === 0);
  if (empty) {
    return NextResponse.json({ error: "validation_error", detail: `"${empty.name}" is empty.` }, { status: 400 });
  }

  const byName = new Map(files.map((file) => [file.name, file]));

  let plan;
  let csvName: string;
  try {
    const selection = partitionImportFiles(files.map((file) => file.name));
    csvName = selection.csv;
    const csvText = await byName.get(selection.csv)!.text();
    plan = planResearchImport(csvText, selection.markdown);
  } catch (error) {
    if (error instanceof ImportError) {
      return NextResponse.json({ error: "validation_error", detail: error.message }, { status: 400 });
    }
    throw error;
  }

  const databases = await repository.listClientDatabases();
  if (!databases.some((database) => database.id === databaseId)) {
    return NextResponse.json({ error: "validation_error", detail: "Client database not found." }, { status: 404 });
  }

  // Reports become documents first, because the change set cannot be built
  // until each row knows its report's id.
  const folders = await repository.listFolders();
  const folder = folders.find((item) => item.name === "Imported research")
    ?? await repository.createFolder("Imported research");

  const documentIdByReport = new Map<string, string>();
  for (const reportFile of plan.reportFiles) {
    const file = byName.get(reportFile)!;
    const result = await ingestDocument({
      folderId: folder.id,
      projectId,
      filename: file.name,
      mimeType: "text/markdown",
      buffer: Buffer.from(await file.arrayBuffer()),
      preferredLanguages: ["en", "ko"]
    });
    documentIdByReport.set(reportFile, result.document.id);
  }

  try {
    const changeSet = await createClientChangeSet({
      projectId,
      databaseId,
      title: `Imported research: ${plan.rows.length} entities`,
      reason: `Bulk import from ${csvName}. Each row links to its own uploaded report.`,
      // Scoped to the CSV name and row count so a retry after a failed
      // response returns the existing set rather than duplicating every row.
      idempotencyKey: `research-import:${databaseId}:${csvName}:${plan.rows.length}`,
      items: buildChangeSetItems(plan.rows, documentIdByReport)
    });
    await submitClientChangeSet(changeSet.id);

    return NextResponse.json({
      data: {
        changeSetId: changeSet.id,
        entities: plan.rows.length,
        documents: documentIdByReport.size,
        unreferenced: plan.unreferenced,
        columns: plan.columns.filter((column) => column !== "reportFile")
      }
    }, { status: 201 });
  } catch (error) {
    // The documents already exist and are useful on their own, so say so
    // rather than implying the whole import vanished.
    return NextResponse.json({
      error: "staging_failed",
      detail: `${documentIdByReport.size} report(s) were uploaded, but staging the rows failed: ` +
        `${error instanceof Error ? error.message : "unknown error"}`
    }, { status: 400 });
  }
}, { rateLimit: "expensive" });
