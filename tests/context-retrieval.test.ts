import { describe, expect, it } from "vitest";
import {
  buildContextPack,
  chunkContent,
  cosineSimilarity,
  detectLanguage,
  getContextPack
} from "@/lib/context/retrieval";
import { repository } from "@/lib/repository";

describe("context retrieval", () => {
  it("detects English, Korean, and mixed-language content", () => {
    expect(detectLanguage("supplier qualification process")).toBe("en");
    expect(detectLanguage("공급업체 품질 검토 절차")).toBe("ko");
    expect(detectLanguage("공급업체 supplier qualification 검토")).toBe("mixed");
  });

  it("chunks long content with stable bounded pieces", () => {
    const content = Array.from({ length: 80 }, (_, index) =>
      `Paragraph ${index + 1}. Supplier qualification evidence remains traceable.`
    ).join("\n\n");
    const chunks = chunkContent(content, 500, 60);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.length <= 501)).toBe(true);
  });

  it("computes cosine similarity for semantic reranking", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [1])).toBe(0);
  });

  it("builds cited packs from approved scoped context only", async () => {
    const marker = `ctx${Date.now().toString(36)}`;
    const project = await repository.createProject({
      name: `한국 공급망 ${marker}`,
      objective: `${marker} 공급업체 후보를 검토하고 근거를 보존합니다.`,
      context: "한국어 원문을 유지합니다.",
      scope: "승인된 정보와 프로젝트 자료",
      constraints: [],
      budgetCents: null
    });
    const otherProject = await repository.createProject({
      name: `Other ${marker}`,
      objective: `Keep unrelated ${marker} confidential from other project context.`,
      context: "unrelated-cross-project-secret",
      scope: "",
      constraints: [],
      budgetCents: null
    });
    const approved = await repository.createKnowledge({
      collection: "Operations",
      title: `Approved ${marker}`,
      content: `${marker} approved workspace evidence`,
      source: "policy"
    });
    await repository.updateKnowledge(approved.id, { status: "approved" });
    await repository.createKnowledge({
      collection: "Operations",
      title: `Proposed ${marker}`,
      content: `${marker} proposed-memory-must-not-be-authoritative`,
      source: null
    });

    // Index unrelated project first, then prove project scoping excludes it.
    await buildContextPack({ query: marker, projectId: otherProject.id, tokenBudget: 4000 });
    const packInput = {
      query: `${marker} 공급업체`,
      projectId: project.id,
      tokenBudget: 4000
    };
    const lexicalPack = await buildContextPack(packInput, async () => {
      throw new Error("Embedding provider unavailable.");
    });
    let embeddedInputs = 0;
    const pack = await buildContextPack(packInput, async (inputs) => {
      embeddedInputs = inputs.length;
      return inputs.map(() => [1, ...Array<number>(1535).fill(0)]);
    });

    expect(pack.queryLanguage).toBe("mixed");
    expect(lexicalPack.embeddingRoute).toBe("lexical_fallback");
    expect(pack.embeddingRoute).toBe("multilingual_embedding");
    expect(embeddedInputs).toBeGreaterThan(1);
    expect(pack.citations.length).toBeGreaterThan(0);
    expect(pack.citations[0]?.score).toBeGreaterThan(lexicalPack.citations[0]?.score ?? 0);
    expect(pack.citations.some((item) => item.sourceId === project.id)).toBe(true);
    expect(pack.citations.some((item) => item.sourceId === approved.id)).toBe(true);
    expect(pack.citations.some((item) => item.sourceId === otherProject.id)).toBe(false);
    expect(pack.citations.some((item) =>
      item.content.includes("proposed-memory-must-not-be-authoritative")
    )).toBe(false);
    expect(new Set(pack.citations.map((item) => item.chunkId)).size).toBe(pack.citations.length);

    const reread = await getContextPack(pack.id);
    expect(reread?.contentHash).toBe(pack.contentHash);
    expect(reread?.citations).toHaveLength(pack.citations.length);
  });
});
