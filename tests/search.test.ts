import { beforeAll, describe, expect, it } from "vitest";
import { repository } from "@/lib/repository";
import { searchWorkspace } from "@/lib/search";

const unique = `zz${Date.now().toString(36)}`;

beforeAll(async () => {
  const project = await repository.createProject({
    name: `Passive component audit ${unique}`,
    objective: `Verify ${unique} lead times across distributors`,
    context: "",
    scope: "",
    constraints: [],
    budgetCents: null
  });
  await repository.createAgenda(project.id, {
    title: "Check distributor quotes",
    instruction: `Confirm the ${unique} quotation before release.`
  });
  const folders = await repository.listFolders();
  await repository.createDocument({
    folderId: folders[0].id,
    projectId: project.id,
    title: "Supplier note",
    filename: "supplier.md",
    mimeType: "text/markdown",
    sourceKind: "markdown",
    sizeBytes: 40,
    pageCount: null,
    wordCount: 8,
    markdown: `Lead times moved. The ${unique} series is now fourteen weeks.`,
    storageKey: null
  });
  await repository.createKnowledge({
    collection: "Suppliers",
    title: `Lead time note ${unique}`,
    content: "Three distributors quote fourteen weeks.",
    source: null
  });
});

describe("searchWorkspace", () => {
  it("ignores queries shorter than two characters", async () => {
    expect(await searchWorkspace("a")).toEqual([]);
    expect(await searchWorkspace("   ")).toEqual([]);
  });

  it("finds matches across every content type", async () => {
    const hits = await searchWorkspace(unique);
    const kinds = new Set(hits.map((hit) => hit.kind));
    expect(kinds).toContain("project");
    expect(kinds).toContain("agenda");
    expect(kinds).toContain("document");
    expect(kinds).toContain("knowledge");
  });

  it("matches text inside a converted document body, not just its title", async () => {
    const hits = await searchWorkspace("fourteen weeks");
    const document = hits.find((hit) => hit.kind === "document");
    expect(document).toBeDefined();
    expect(document?.excerpt.toLowerCase()).toContain("fourteen weeks");
  });

  it("is case insensitive", async () => {
    const lower = await searchWorkspace(unique.toLowerCase());
    const upper = await searchWorkspace(unique.toUpperCase());
    expect(upper.length).toBe(lower.length);
    expect(upper.length).toBeGreaterThan(0);
  });

  it("carries the project so a hit can navigate", async () => {
    const hits = await searchWorkspace(unique);
    const document = hits.find((hit) => hit.kind === "document");
    expect(document?.documentId).toBeTruthy();
    expect(document?.projectId).toBeTruthy();
  });

  it("returns nothing for a term that appears nowhere", async () => {
    expect(await searchWorkspace("qqqzzzxxnotpresent")).toEqual([]);
  });
});

describe("client records", () => {
  it("stores imported rows and deletes them individually", async () => {
    const database = await repository.createClientDatabase({
      name: `Prospects ${unique}`,
      description: ""
    });
    const created = await repository.createRecords(database.id, [
      { Company: "Sejong MedTech", Units: "24000" },
      { Company: "Namsan Robotics, Inc.", Units: "5200" }
    ]);
    expect(created).toHaveLength(2);

    const listed = await repository.listRecords(database.id);
    expect(listed).toHaveLength(2);
    expect(listed.map((record) => record.data.Company)).toContain("Namsan Robotics, Inc.");

    expect(await repository.deleteRecord(created[0].id)).toBe(true);
    expect(await repository.listRecords(database.id)).toHaveLength(1);
  });

  it("treats an empty import as a no-op", async () => {
    const database = await repository.createClientDatabase({ name: `Empty ${unique}`, description: "" });
    expect(await repository.createRecords(database.id, [])).toEqual([]);
  });
});

describe("document list payloads", () => {
  it("omits markdown bodies from the list read", async () => {
    const documents = await repository.listDocuments();
    expect(documents.length).toBeGreaterThan(0);
    for (const document of documents) {
      expect(document).not.toHaveProperty("markdown");
    }
  });

  it("still returns the body on a single-document read", async () => {
    const [first] = await repository.listDocuments();
    const detail = await repository.getDocument(first.id);
    expect(typeof detail?.markdown).toBe("string");
  });
});
