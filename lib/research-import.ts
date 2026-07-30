/**
 * Validation for an external research import: one CSV of entities, one
 * Markdown report each.
 *
 * Lives here rather than in the importer script so the CLI and the in-app
 * upload enforce the same rules. Two copies of "which CSV shapes are
 * acceptable" would drift, and the drift would only surface as rows entering
 * client data through one path that the other would have rejected.
 *
 * Everything in this module is pure: no filesystem, no network, no database.
 */

export const LINK_COLUMN = "Dossier Document";
export const ROUTING_COLUMN = "reportFile";
/** The change-set API caps items at 1000; refusing earlier gives a better message. */
export const MAX_ROWS = 1000;

export type ImportRow = Record<string, string>;

export type ImportPlan = {
  rows: ImportRow[];
  columns: string[];
  /** Report filenames referenced by a row, in row order. */
  reportFiles: string[];
  /** Supplied .md files no row points at — ignored, not an error. */
  unreferenced: string[];
};

export class ImportError extends Error {}

/**
 * RFC 4180 parsing, written out rather than pulled in as a dependency.
 * Splitting on commas corrupts any field containing one, which for company
 * data means addresses and legal names - the fields most likely to be wrong
 * in a way nobody notices until the row is already approved.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
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

/**
 * Turns a CSV and a set of available report filenames into an import plan, or
 * throws with a message naming the fix.
 *
 * Validation is total: every problem is found before a caller uploads
 * anything, because a missing report discovered at row 87 would otherwise
 * leave 86 orphaned documents behind.
 */
export function planResearchImport(csvText: string, markdownFilenames: string[]): ImportPlan {
  const [header, ...body] = parseCsv(csvText);
  if (!header) throw new ImportError("The CSV is empty.");

  const columns = header.map((name) => name.trim());
  if (columns.some((name) => name === "")) {
    throw new ImportError("The CSV header has a blank column name. Every column becomes a database field and needs a name.");
  }
  if (new Set(columns).size !== columns.length) {
    throw new ImportError("The CSV has duplicate column names; each becomes a database field, so they must be unique.");
  }
  if (columns.includes(LINK_COLUMN)) {
    throw new ImportError(`Remove the "${LINK_COLUMN}" column — it is filled in with each uploaded report's id.`);
  }
  if (!columns.includes(ROUTING_COLUMN)) {
    throw new ImportError(`The CSV needs a "${ROUTING_COLUMN}" column naming each entity's .md file.`);
  }

  const rows = body.map((cells, index) => {
    const record: ImportRow = {};
    // Every value is stringified: the change-set API validates `after` as
    // Record<string,string> and rejects an unquoted number outright.
    columns.forEach((column, position) => {
      record[column] = String(cells[position] ?? "").trim();
    });
    if (!record[ROUTING_COLUMN]) {
      throw new ImportError(`Row ${index + 2} has no ${ROUTING_COLUMN} value.`);
    }
    return record;
  });

  if (rows.length === 0) throw new ImportError("The CSV has a header but no rows.");
  if (rows.length > MAX_ROWS) {
    throw new ImportError(`${rows.length} rows exceeds the ${MAX_ROWS}-row limit for one import. Split the CSV.`);
  }

  const reportFiles = rows.map((row) => row[ROUTING_COLUMN]);
  const duplicated = reportFiles.filter((name, index) => reportFiles.indexOf(name) !== index);
  if (duplicated.length > 0) {
    throw new ImportError(`Two or more rows point at the same report "${duplicated[0]}". Each entity needs its own file.`);
  }

  const available = new Set(markdownFilenames);
  const missing = reportFiles.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new ImportError(
      `${missing.length} row(s) reference a report that was not supplied, first: "${missing[0]}"`
    );
  }

  const referenced = new Set(reportFiles);
  return {
    rows,
    columns,
    reportFiles,
    unreferenced: markdownFilenames.filter((name) => !referenced.has(name))
  };
}

/** Rejects anything that is not .csv or .md, naming the offenders. */
export function partitionImportFiles(filenames: string[]) {
  const extensionOf = (name: string) => {
    const dot = name.lastIndexOf(".");
    return dot === -1 ? "" : name.slice(dot).toLowerCase();
  };
  const csv = filenames.filter((name) => extensionOf(name) === ".csv");
  const markdown = filenames.filter((name) => extensionOf(name) === ".md");
  const rejected = filenames.filter((name) => ![".csv", ".md"].includes(extensionOf(name)));

  if (rejected.length > 0) {
    throw new ImportError(
      `Only .csv and .md are accepted. Remove: ${rejected.slice(0, 5).join(", ")}` +
      `${rejected.length > 5 ? ` (+${rejected.length - 5} more)` : ""}`
    );
  }
  if (csv.length !== 1) {
    throw new ImportError(`Select exactly one .csv file — found ${csv.length}.`);
  }
  if (markdown.length === 0) {
    throw new ImportError("Select the .md report files alongside the CSV.");
  }
  return { csv: csv[0], markdown };
}

/**
 * Builds the change-set items once every report has an id.
 *
 * `reportFile` is routing information, not a field anyone wants as a column,
 * so it is dropped rather than carried into client data.
 */
export function buildChangeSetItems(
  rows: ImportRow[],
  documentIdByReport: Map<string, string>
) {
  return rows.map((row) => {
    const after: ImportRow = { ...row };
    const reportFile = after[ROUTING_COLUMN];
    delete after[ROUTING_COLUMN];
    const documentId = documentIdByReport.get(reportFile);
    if (!documentId) throw new ImportError(`No uploaded report for "${reportFile}".`);
    after[LINK_COLUMN] = documentId;
    return { operation: "insert" as const, after };
  });
}
