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
import { basename, extname, join } from "node:path";

const LINK_COLUMN = "Dossier Document";
const MAX_ITEMS = 1000;

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

// ── CSV ──────────────────────────────────────────────────────────────────
/**
 * RFC 4180 parsing, written out rather than pulled in as a dependency: a
 * naive split on commas corrupts any field containing a comma, which for
 * company data means addresses and legal names — the fields most likely to
 * be wrong in a way nobody notices until the row is already approved.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\r") continue;
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

function rowsToRecords(rows) {
  const [header, ...body] = rows;
  if (!header) fail("The CSV is empty.");
  const columns = header.map((name) => name.trim());

  if (new Set(columns).size !== columns.length) {
    fail("The CSV has duplicate column names; each becomes a database field, so they must be unique.");
  }
  if (columns.includes(LINK_COLUMN)) {
    fail(`Remove the "${LINK_COLUMN}" column — this script fills it with the uploaded report's id.`);
  }
  if (!columns.includes("reportFile")) {
    fail('The CSV needs a "reportFile" column naming each entity\'s .md file.');
  }

  return body.map((cells, index) => {
    const record = {};
    columns.forEach((column, position) => {
      // Every value is stringified: the change-set API validates `after` as
      // Record<string,string>, so an unquoted number is rejected outright.
      record[column] = String(cells[position] ?? "").trim();
    });
    if (!record.reportFile) fail(`Row ${index + 2} has no reportFile value.`);
    return record;
  });
}

// ── load and validate ────────────────────────────────────────────────────
const entries = await readdir(dir, { withFileTypes: true }).catch(() => fail(`Cannot read folder: ${dir}`));
const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

const csvFiles = files.filter((name) => extname(name).toLowerCase() === ".csv");
const markdownFiles = files.filter((name) => extname(name).toLowerCase() === ".md");
const rejected = files.filter((name) => ![".csv", ".md"].includes(extname(name).toLowerCase()));

if (csvFiles.length !== 1) {
  fail(`Expected exactly one .csv in ${dir}, found ${csvFiles.length}.`);
}
if (rejected.length > 0) {
  fail(`Only .csv and .md are accepted. Convert or remove: ${rejected.slice(0, 8).join(", ")}${rejected.length > 8 ? ` (+${rejected.length - 8} more)` : ""}`);
}

const records = rowsToRecords(parseCsv(await readFile(join(dir, csvFiles[0]), "utf8")));
if (records.length === 0) fail("The CSV has a header but no rows.");
if (records.length > MAX_ITEMS) {
  fail(`${records.length} rows exceeds the ${MAX_ITEMS}-item change-set limit. Split the CSV.`);
}

// Every referenced report must exist before anything is uploaded — a missing
// file discovered at row 87 would otherwise leave 86 orphaned documents.
const available = new Set(markdownFiles);
const missing = records.filter((record) => !available.has(record.reportFile));
if (missing.length > 0) {
  fail(`${missing.length} row(s) reference a missing .md file, first: "${missing[0].reportFile}"`);
}
const referenced = new Set(records.map((record) => record.reportFile));
const orphans = markdownFiles.filter((name) => !referenced.has(name));

console.log(`\n  ${csvFiles[0]}: ${records.length} rows, ${records[0] ? Object.keys(records[0]).length : 0} columns`);
console.log(`  reports:  ${records.length} matched${orphans.length > 0 ? `, ${orphans.length} unreferenced .md ignored` : ""}`);
console.log(`  linking:  "${LINK_COLUMN}" -> uploaded document id`);

if (dryRun) {
  console.log(`\n  Dry run — nothing uploaded. Columns: ${Object.keys(records[0]).join(", ")}\n`);
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
const items = records.map((record) => {
  const after = { ...record, [LINK_COLUMN]: documentIds.get(record.reportFile) };
  // reportFile was routing information, not a field anyone wants as a column.
  delete after.reportFile;
  return { operation: "insert", after };
});

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
