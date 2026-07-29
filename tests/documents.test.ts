import { describe, expect, it } from "vitest";
import { convertToMarkdown, detectKind, titleFromFilename } from "@/lib/documents/convert";
import { repository } from "@/lib/repository";

const buffer = (value: string) => Buffer.from(value, "utf8");

describe("detectKind", () => {
  it("classifies by extension when the browser sends no useful mime type", () => {
    expect(detectKind("brief.pdf", "")).toBe("pdf");
    expect(detectKind("notes.MD", "")).toBe("markdown");
    expect(detectKind("leads.tsv", "")).toBe("csv");
    expect(detectKind("archive.zip", "application/zip")).toBe("unknown");
  });

  it("falls back to the mime type when the name has no extension", () => {
    expect(detectKind("upload", "application/pdf")).toBe("pdf");
    expect(detectKind("upload", "text/plain")).toBe("text");
  });
});

describe("titleFromFilename", () => {
  it("humanizes separators and drops the extension", () => {
    expect(titleFromFilename("supplier_risk-note.pdf")).toBe("Supplier risk note");
  });
});

describe("convertToMarkdown", () => {
  it("rejoins hard-wrapped text into paragraphs", async () => {
    const result = await convertToMarkdown(
      "note.txt",
      "text/plain",
      buffer("Plain briefing note.\nLine two continues here.\n\nSecond paragraph.\n")
    );
    expect(result.kind).toBe("text");
    expect(result.markdown).toBe("Plain briefing note. Line two continues here.\n\nSecond paragraph.");
  });

  it("repairs words split across a line break by a hyphen", async () => {
    const result = await convertToMarkdown(
      "note.txt",
      "text/plain",
      buffer("The substi-\ntution needs approval.")
    );
    expect(result.markdown).toBe("The substitution needs approval.");
  });

  it("builds a markdown table from CSV, honouring quoted delimiters", async () => {
    const csv = 'Company,Units\n"Namsan Robotics, Inc.",5200\nHanbit Devices,9500\n';
    const result = await convertToMarkdown("leads.csv", "text/csv", buffer(csv));
    expect(result.kind).toBe("csv");
    expect(result.markdown.split("\n")).toEqual([
      "| Company | Units |",
      "| --- | --- |",
      "| Namsan Robotics, Inc. | 5200 |",
      "| Hanbit Devices | 9500 |"
    ]);
  });

  it("escapes pipes so a cell cannot break the table", async () => {
    const result = await convertToMarkdown("t.csv", "text/csv", buffer('A\n"x|y"\n'));
    expect(result.markdown).toContain("x\\|y");
  });

  it("takes the title from the first real heading in markdown", async () => {
    const result = await convertToMarkdown(
      "sample.md",
      "text/markdown",
      buffer("# Supplier Risk Note\n\nLead times moved.")
    );
    expect(result.title).toBe("Supplier Risk Note");
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it("pretty-prints JSON into a fenced block", async () => {
    const result = await convertToMarkdown("q.json", "application/json", buffer('{"id":"Q-1"}'));
    expect(result.markdown).toBe('```json\n{\n  "id": "Q-1"\n}\n```');
  });

  it("converts HTML to markdown and strips scripts", async () => {
    const html = "<h1>Report</h1><p>Body text</p><script>alert(1)</script>";
    const result = await convertToMarkdown("r.html", "text/html", buffer(html));
    expect(result.markdown).toContain("# Report");
    expect(result.markdown).not.toContain("alert");
  });

  it("rejects file types it cannot read", async () => {
    await expect(convertToMarkdown("a.zip", "application/zip", buffer("PK"))).rejects.toThrow(
      /Unsupported file type/
    );
  });

  it("reports empty extractions instead of producing a blank document", async () => {
    const result = await convertToMarkdown("empty.txt", "text/plain", buffer("   \n  \n"));
    expect(result.markdown).toContain("No extractable text");
  });
});

describe("document repository", () => {
  it("moves a document between folders and deletes it", async () => {
    const folders = await repository.listFolders();
    expect(folders.length).toBeGreaterThan(1);

    const created = await repository.createDocument({
      folderId: folders[0].id,
      projectId: null,
      title: "Moved document",
      filename: "moved.md",
      mimeType: "text/markdown",
      sourceKind: "markdown",
      sizeBytes: 12,
      pageCount: null,
      wordCount: 2,
      markdown: "# Moved",
      storageKey: null
    });

    const moved = await repository.updateDocument(created.id, { folderId: folders[1].id });
    expect(moved?.folderId).toBe(folders[1].id);

    const reread = await repository.getDocument(created.id);
    expect(reread?.markdown).toBe("# Moved");

    expect(await repository.deleteDocument(created.id)).toBe(true);
    expect(await repository.getDocument(created.id)).toBeUndefined();
  });

  it("assigns run event sequences without collisions", async () => {
    const command = await repository.createCommand({
      page: "projects",
      projectId: null,
      instruction: "Verify that appended run events receive monotonic sequence numbers."
    });
    const run = await repository.createRun(command);

    await repository.appendEvent(run.id, { type: "run.planning", message: "one" });
    await repository.appendEvent(run.id, { type: "run.progress", message: "two" });

    const events = await repository.listEvents(run.id);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(events.at(-1)?.message).toBe("two");
  });
});
