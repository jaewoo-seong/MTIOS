import { describe, expect, it } from "vitest";
import {
  activateResearchProjectInput,
  createCrossProjectReportInput,
  draftResearchProjectInput,
  externalMcpToolCatalog,
  getExternalDocumentInput,
  listResearchProjectsInput
} from "@/lib/mcp/external-contracts";

const id = "10000000-0000-4000-8000-000000000001";

describe("external MCP contracts", () => {
  it("publishes a unique, minimal eight-tool catalog", () => {
    expect(externalMcpToolCatalog).toHaveLength(9);
    expect(new Set(externalMcpToolCatalog.map((tool) => tool.name)).size).toBe(9);
  });

  it("applies bounded pagination defaults", () => {
    expect(listResearchProjectsInput.parse({})).toEqual({ limit: 20, cursor: null });
    expect(() => listResearchProjectsInput.parse({ limit: 101 })).toThrow();
  });

  it("bounds conversation context and requires idempotency for drafts", () => {
    expect(() => draftResearchProjectInput.parse({ title: "A", objective: "B", conversationSummary: "x".repeat(12001), idempotencyKey: "stable-key" })).toThrow();
    expect(() => draftResearchProjectInput.parse({ title: "A", objective: "B" })).toThrow();
  });

  it("requires exact approval text for paid operations", () => {
    expect(() => activateResearchProjectInput.parse({ projectId: id, strategyVersionId: id, confirmation: "yes", idempotencyKey: "stable-key" })).toThrow();
    expect(() => createCrossProjectReportInput.parse({ title: "Report", projectIds: [id], objective: "Compare", sections: ["Summary"], confirmation: "yes", idempotencyKey: "stable-key" })).toThrow();
  });

  it("defaults reports to approved dossiers and bounded source context", () => {
    const parsed = createCrossProjectReportInput.parse({
      title: "Report",
      projectIds: [id],
      objective: "Compare",
      sections: ["Summary"],
      confirmation: "I approve creating this report.",
      idempotencyKey: "stable-key"
    });
    expect(parsed).toMatchObject({
      evidencePolicy: "approved_dossiers_only",
      sourceDocumentIds: [],
      maxSources: 40,
      maxSourceCharacters: 80000
    });
    expect(() => createCrossProjectReportInput.parse({ ...parsed, maxSourceCharacters: 200001 })).toThrow();
  });

  it("caps document retrieval", () => {
    expect(getExternalDocumentInput.parse({ documentId: id }).maxCharacters).toBe(30000);
    expect(() => getExternalDocumentInput.parse({ documentId: id, maxCharacters: 50001 })).toThrow();
  });
});
