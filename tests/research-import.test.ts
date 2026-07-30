import { describe, expect, it } from "vitest";
import {
  buildChangeSetItems,
  LINK_COLUMN,
  parseCsv,
  partitionImportFiles,
  planResearchImport
} from "@/lib/research-import";

const csv = [
  "companyName,country,fundingGoalUsd,reportFile",
  "Acme Robotics,USA,50000,acme-robotics.md",
  "Bolt Devices,Korea,12000,bolt-devices.md"
].join("\n");
const reports = ["acme-robotics.md", "bolt-devices.md"];

describe("CSV parsing", () => {
  it("keeps commas inside quoted fields instead of splitting on them", () => {
    const rows = parseCsv('name,note\nAcme,"Builds arms, grippers, and mounts"');
    expect(rows[1]).toEqual(["Acme", "Builds arms, grippers, and mounts"]);
  });

  it("unescapes doubled quotes", () => {
    const rows = parseCsv('name,note\nCinder,"Quoted ""best in class"" by press"');
    expect(rows[1][1]).toBe('Quoted "best in class" by press');
  });

  it("ignores blank lines rather than emitting empty rows", () => {
    expect(parseCsv("a,b\n1,2\n\n\n3,4")).toHaveLength(3);
  });

  it("reads a final row that has no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toHaveLength(2);
  });
});

describe("import planning", () => {
  it("produces one row per entity with every value as a string", () => {
    const plan = planResearchImport(csv, reports);
    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0]).toEqual({
      companyName: "Acme Robotics",
      country: "USA",
      fundingGoalUsd: "50000",
      reportFile: "acme-robotics.md"
    });
    expect(Object.values(plan.rows[0]).every((value) => typeof value === "string")).toBe(true);
  });

  it("reports supplied reports that no row references, without failing", () => {
    const plan = planResearchImport(csv, [...reports, "extra.md"]);
    expect(plan.unreferenced).toEqual(["extra.md"]);
  });

  it("rejects a row whose report was not supplied", () => {
    expect(() => planResearchImport(csv, ["acme-robotics.md"]))
      .toThrow(/not supplied, first: "bolt-devices.md"/);
  });

  it("rejects two rows pointing at the same report", () => {
    const duplicate = [
      "companyName,reportFile",
      "Acme,shared.md",
      "Bolt,shared.md"
    ].join("\n");
    expect(() => planResearchImport(duplicate, ["shared.md"]))
      .toThrow(/same report "shared.md"/);
  });

  it("rejects a CSV that already has the link column", () => {
    const withLink = [`companyName,reportFile,${LINK_COLUMN}`, "Acme,a.md,anything"].join("\n");
    expect(() => planResearchImport(withLink, ["a.md"])).toThrow(new RegExp(LINK_COLUMN));
  });

  it("rejects a CSV with no reportFile column", () => {
    expect(() => planResearchImport("companyName\nAcme", [])).toThrow(/reportFile/);
  });

  it("rejects duplicate and blank column names", () => {
    expect(() => planResearchImport("name,name,reportFile\na,b,c.md", ["c.md"])).toThrow(/duplicate/i);
    expect(() => planResearchImport("name,,reportFile\na,b,c.md", ["c.md"])).toThrow(/blank column/i);
  });

  it("rejects a header with no rows", () => {
    expect(() => planResearchImport("companyName,reportFile", [])).toThrow(/no rows/i);
  });

  it("names the offending row number when reportFile is empty", () => {
    const blank = ["companyName,reportFile", "Acme,a.md", "Bolt,"].join("\n");
    expect(() => planResearchImport(blank, ["a.md"])).toThrow(/Row 3/);
  });
});

describe("file selection", () => {
  it("accepts one CSV alongside markdown reports", () => {
    const result = partitionImportFiles(["companies.csv", "a.md", "b.md"]);
    expect(result).toEqual({ csv: "companies.csv", markdown: ["a.md", "b.md"] });
  });

  it("rejects any other file type by name", () => {
    expect(() => partitionImportFiles(["companies.csv", "a.md", "scan.pdf"]))
      .toThrow(/Only \.csv and \.md are accepted.*scan\.pdf/s);
  });

  it("rejects zero or multiple CSVs", () => {
    expect(() => partitionImportFiles(["a.md"])).toThrow(/exactly one \.csv/);
    expect(() => partitionImportFiles(["a.csv", "b.csv", "a.md"])).toThrow(/exactly one \.csv/);
  });

  it("rejects a CSV with no reports", () => {
    expect(() => partitionImportFiles(["companies.csv"])).toThrow(/\.md report files/);
  });

  it("matches extensions case-insensitively", () => {
    expect(partitionImportFiles(["Companies.CSV", "Acme.MD"]).csv).toBe("Companies.CSV");
  });
});

describe("change-set items", () => {
  it("links each row to its report and drops the routing column", () => {
    const plan = planResearchImport(csv, reports);
    const items = buildChangeSetItems(plan.rows, new Map([
      ["acme-robotics.md", "doc-1"],
      ["bolt-devices.md", "doc-2"]
    ]));

    expect(items[0].operation).toBe("insert");
    expect(items[0].after[LINK_COLUMN]).toBe("doc-1");
    expect(items[1].after[LINK_COLUMN]).toBe("doc-2");
    // Routing information must not become a database column.
    expect(items[0].after.reportFile).toBeUndefined();
    expect(items[0].after.companyName).toBe("Acme Robotics");
  });

  it("refuses to stage a row whose report was never uploaded", () => {
    const plan = planResearchImport(csv, reports);
    expect(() => buildChangeSetItems(plan.rows, new Map([["acme-robotics.md", "doc-1"]])))
      .toThrow(/No uploaded report for "bolt-devices.md"/);
  });
});
