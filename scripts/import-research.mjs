/**
 * Bulk-import externally produced research: one CSV of entities, one Markdown
 * report per entity, linked so each row opens its report.
 *
 * Only .csv and .md are accepted, deliberately. PDF and DOCX would route
 * through the document-conversion service — a paid, CPU-bound OCR call per
 * file — and an import of a hundred reports is exactly where that cost is
 * least justified, because the source is already text.
 *
 * Nothing is written directly to client data: `POST /records` returns 405 by
 * design, so entities enter as a change set that a human approves. This
 * script stops at "submitted for review" and never approves on your behalf.
 *
 * Usage:
 *   railway run --service app node scripts/import-research.mjs <dir> --database <uuid> --project <uuid>
 *
 * `railway run` supplies APP_URL and ADMIN_USERNAME/ADMIN_PASSWORD from the
 * service, so no credential is typed, pasted, or stored on disk.
 *
 * Add --dry-run to validate the folder and print what would happen without
 * uploading anything. Run that first: it costs nothing and catches the
 * mistakes that are expensive to unwind after 100 documents exist.
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  buildChangeSetItems,
  ImportError,
  LINK_COLUMN,
  partitionImportFiles,
  planResearchImport
} from "../lib/research-import.ts";

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

// ── arguments ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dir = args.find((arg) => !arg.startsWith("--"));
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : args[index + 1] ?? null;
};
const dryRun = args.includes("--dry-run");
const databaseId = flag("database");
const projectId = flag("project");

if (!dir) fail("Pass the import folder: node scripts/import-research.mjs <dir> --database <uuid> --project <uuid>");
if (!databaseId || !projectId) fail("--database and --project are both required (UUIDs from Client & Data and Projects).");

const baseUrl = process.env.APP_URL;
const username = process.env.ADMIN_USERNAME ?? "operator";
const password = process.env.ADMIN_PASSWORD;
// Credentials are checked below, after the dry-run exit: validating a folder
// touches no network, and demanding a login to do it would discourage the
// cheap check that catches the expensive mistakes.

// ── load and validate ────────────────────────────────────────────────────
// Shared with the in-app importer so the CLI cannot accept a shape the UI
// rejects, or the reverse.
const entries = await readdir(dir, { withFileTypes: true }).catch(() => fail(`Cannot read folder: ${dir}`));
const filenames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

let selection;
let plan;
try {
  selection = partitionImportFiles(filenames);
  plan = planResearchImport(await readFile(join(dir, selection.csv), "utf8"), selection.markdown);
} catch (error) {
  if (error instanceof ImportError) fail(error.message);
  throw error;
}
const records = plan.rows;

console.log(`\n  ${selection.csv}: ${records.length} rows, ${plan.columns.length} columns`);
console.log(`  reports:  ${records.length} matched${plan.unreferenced.length > 0 ? `, ${plan.unreferenced.length} unreferenced .md ignored` : ""}`);
console.log(`  linking:  "${LINK_COLUMN}" -> uploaded document id`);

if (dryRun) {
  console.log(`\n  Dry run — nothing uploaded. Columns: ${plan.columns.join(", ")}\n`);
  process.exit(0);
}

// ── authenticate ─────────────────────────────────────────────────────────
if (!baseUrl || !password) {
  fail("APP_URL and ADMIN_PASSWORD are required. Run through: railway run --service app node scripts/import-research.mjs …");
}
const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password })
});
if (login.status !== 200) {
  fail(`Login returned ${login.status}. Check ADMIN_USERNAME and ADMIN_PASSWORD.`);
}
const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
if (!cookie) fail("Login succeeded but returned no session cookie.");

// ── upload reports ───────────────────────────────────────────────────────
const documentIds = new Map();
for (const [index, record] of records.entries()) {
  const name = record.reportFile;
  const body = new FormData();
  body.set("file", new File([await readFile(join(dir, name))], name, { type: "text/markdown" }));
  body.set("projectId", projectId);

  const response = await fetch(`${baseUrl}/api/v1/documents`, {
    method: "POST", headers: { Cookie: cookie }, body
  });
  const payload = await response.json().catch(() => null);
  if (response.status !== 201) {
    fail(`Upload failed for ${name} (${response.status}): ${payload?.detail ?? payload?.error ?? "unknown"}. ${documentIds.size} document(s) were already created; delete them before re-running.`);
  }
  documentIds.set(name, payload.data.id);
  process.stdout.write(`\r  uploading ${index + 1}/${records.length}`);
  // Uploads are rate-limited as "expensive"; pacing beats being rejected
  // partway through with documents already created.
  await new Promise((resolve) => setTimeout(resolve, 250));
}
console.log(`\r  uploaded  ${documentIds.size}/${records.length} reports        `);

// ── stage the change set ─────────────────────────────────────────────────
const items = buildChangeSetItems(records, documentIds);

const created = await fetch(`${baseUrl}/api/v1/client-change-sets`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({
    projectId,
    databaseId,
    title: `Imported research: ${records.length} entities`,
    reason: `Bulk import from ${basename(dir)}. Each row links to its own uploaded report.`,
    // Scoped to this folder and row count so a re-run after a partial failure
    // returns the existing set instead of creating a second one.
    idempotencyKey: `import:${basename(dir)}:${records.length}`,
    items
  })
});
const createdPayload = await created.json().catch(() => null);
if (created.status !== 201) {
  fail(`Change set rejected (${created.status}): ${createdPayload?.error ?? "unknown"}`);
}
const changeSetId = createdPayload.data.id;

const submitted = await fetch(`${baseUrl}/api/v1/client-change-sets/${changeSetId}/submit`, {
  method: "POST", headers: { Cookie: cookie }
});
if (!submitted.ok) {
  console.log(`\n  Change set ${changeSetId} was created but not submitted (${submitted.status}). Submit it from the project workspace.\n`);
  process.exit(0);
}

console.log(`
  Staged for review — nothing is in the database yet.

    change set  ${changeSetId}
    entities    ${records.length}
    documents   ${documentIds.size}

  Approve it in the project workspace. After approval, each row shows a
  "View report" action opening its report.
`);
