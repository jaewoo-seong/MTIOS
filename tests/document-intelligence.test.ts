import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import {
  approveDocumentRevision,
  exportEditableDocument,
  getDocumentIntelligence,
  getDocumentIntelligenceTestState,
  getLatestApprovedDocumentRevision,
  ingestDocument,
  proposeAiDocumentRepair,
  type IntelligenceResult
} from "@/lib/documents/intelligence";
import { buildContextPack } from "@/lib/context/retrieval";
import { repository } from "@/lib/repository";

beforeEach(() => {
  const state = getDocumentIntelligenceTestState();
  for (const list of Object.values(state)) list.splice(0);
  delete process.env.DOCUMENT_CONVERSION_SERVICE_URL;
  delete process.env.DOCUMENT_CONVERSION_SERVICE_SECRET;
});

async function projectAndFolder() {
  const project = await repository.createProject({
    name: `Document intelligence ${crypto.randomUUID()}`,
    objective: "Verify source-preserving conversion.",
    context: "",
    scope: "",
    constraints: [],
    budgetCents: 1000
  });
  const folders = await repository.listFolders();
  if (!folders[0]) throw new Error("Document folder missing.");
  return { project, folder: folders[0] };
}

describe("document intelligence pipeline", () => {
  it("uses PNG page previews supported by the production PyMuPDF build", async () => {
    const service = await readFile(
      new URL("../services/document-conversion/app.py", import.meta.url),
      "utf8"
    );
    expect(service).toContain('.tobytes("png")');
    expect(service).toContain('"image/png"');
    expect(service).not.toContain('.tobytes("webp")');
  });

  it("stores the original before conversion and creates an approved initial revision", async () => {
    const { project, folder } = await projectAndFolder();
    const calls: string[] = [];
    const result = await ingestDocument({
      folderId: folder.id,
      projectId: project.id,
      filename: "bilingual-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("English source.\n\n한국어 원본."),
      storeOriginal: async (key, contentType, body) => {
        calls.push(`${key}:${contentType}:${body.byteLength}`);
        return { key, contentType, size: body.byteLength };
      }
    });
    expect(calls).toHaveLength(1);
    expect(result.originalStored).toBe(true);
    expect(result.document.storageKey).toContain("documents/originals/");
    expect(result.conversion).toMatchObject({
      status: "completed",
      language: "multilingual"
    });
    const detail = await getDocumentIntelligence(result.document.id);
    expect(detail?.revisions).toHaveLength(1);
    expect(detail?.revisions[0]).toMatchObject({ source: "conversion", approved: true });
    expect(await getLatestApprovedDocumentRevision(result.document.id)).toBeTruthy();
  });

  it("keeps low-confidence OCR output out of context until explicit approval", async () => {
    const { project, folder } = await projectAndFolder();
    const marker = `검토필요-${crypto.randomUUID()}`;
    const uncertain: IntelligenceResult = {
      title: "Scanned source",
      markdown: marker,
      kind: "pdf",
      pageCount: 1,
      wordCount: 1,
      truncated: false,
      engine: "mock-ocr",
      engineVersion: "1",
      language: "ko",
      ocrUsed: true,
      confidence: 48,
      warnings: ["Low OCR confidence."],
      needsReview: true,
      pages: [{
        pageNumber: 1,
        width: 100,
        height: 200,
        text: marker,
        confidence: 48,
        imageStorageKey: null,
        blocks: [{
          type: "paragraph",
          position: 0,
          text: marker,
          bbox: { x: 1, y: 2, width: 30, height: 10 },
          confidence: 48,
          extractionMethod: "ocr"
        }],
        tables: [],
        images: []
      }]
    };
    const result = await ingestDocument({
      folderId: folder.id,
      projectId: project.id,
      filename: "scan.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-mock"),
      converter: async () => uncertain
    });
    expect(result.conversion.status).toBe("review_required");
    expect(await getLatestApprovedDocumentRevision(result.document.id)).toBeNull();
    expect((await buildContextPack({
      projectId: project.id,
      query: marker,
      tokenBudget: 4000
    })).citations.some((citation) => citation.sourceId === result.document.id)).toBe(false);

    const detail = await getDocumentIntelligence(result.document.id);
    const revision = detail?.revisions[0];
    if (!revision) throw new Error("Conversion revision missing.");
    await approveDocumentRevision(result.document.id, String(revision.id));
    expect(await getLatestApprovedDocumentRevision(result.document.id)).toBeTruthy();
    expect((await buildContextPack({
      projectId: project.id,
      query: marker,
      tokenBudget: 4000
    })).citations.some((citation) => citation.sourceId === result.document.id)).toBe(true);
  });

  it("preserves a failed source and exposes conversion failure instead of authoritative text", async () => {
    const { project, folder } = await projectAndFolder();
    const result = await ingestDocument({
      folderId: folder.id,
      projectId: project.id,
      filename: "failed.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-failed"),
      converter: async () => {
        throw new Error("OCR engine unavailable.");
      }
    });
    expect(result.document.id).toBeTruthy();
    expect(result.conversion).toMatchObject({
      status: "failed",
      error: "OCR engine unavailable."
    });
    expect(await getLatestApprovedDocumentRevision(result.document.id)).toBeNull();
  });

  it("delegates Korean-safe PDF and DOCX exports to the private service", async () => {
    process.env.DOCUMENT_CONVERSION_SERVICE_URL = "http://conversion.internal:3003";
    process.env.DOCUMENT_CONVERSION_SERVICE_SECRET = "conversion-secret";
    const calls: Array<{ url: string; authorization: string | null; body: string }> = [];
    const output = await exportEditableDocument({
      title: "한국어 보고서",
      markdown: "# 내용",
      format: "pdf",
      fetcher: async (input, init) => {
        calls.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
          body: String(init?.body)
        });
        return new Response(new Uint8Array([37, 80, 68, 70]), {
          headers: { "content-type": "application/pdf" }
        });
      }
    });
    expect(output.toString()).toBe("%PDF");
    expect(calls[0]).toMatchObject({
      url: "http://conversion.internal:3003/v1/export",
      authorization: "Bearer conversion-secret"
    });
    expect(calls[0].body).toContain("한국어 보고서");
  });

  it("limits AI repair to uncertain conversions and requires approval before replacing content", async () => {
    const { project, folder } = await projectAndFolder();
    const uncertain: IntelligenceResult = {
      title: "Repair review",
      markdown: "HEADING\nrow one | row two",
      kind: "pdf",
      pageCount: 1,
      wordCount: 5,
      truncated: false,
      engine: "mock-ocr",
      engineVersion: "1",
      language: "en",
      ocrUsed: true,
      confidence: 55,
      warnings: ["Reading order uncertain."],
      needsReview: true,
      pages: [{
        pageNumber: 1,
        width: 100,
        height: 100,
        text: "HEADING row one row two",
        confidence: 55,
        imageStorageKey: null,
        blocks: [],
        tables: [],
        images: []
      }]
    };
    const result = await ingestDocument({
      folderId: folder.id,
      projectId: project.id,
      filename: "repair.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-repair"),
      converter: async () => uncertain
    });
    process.env.LITELLM_BASE_URL = "http://litellm.internal:4000";
    process.env.LITELLM_API_KEY = "litellm-test";
    const proposal = await proposeAiDocumentRepair(result.document.id, async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ content: string }>;
      };
      expect(request.model).toBe("worker_structured");
      expect(request.messages[0].content).toContain("Do not add");
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({
              markdown: "# HEADING\n\n| row one | row two |\n| --- | --- |",
              changes: ["Restored heading and table structure."]
            })
          }
        }]
      });
    });
    expect(proposal.approvalRequired).toBe(true);
    expect((await repository.getDocument(result.document.id))?.markdown).toBe(uncertain.markdown);
    expect(await getLatestApprovedDocumentRevision(result.document.id)).toBeNull();
    await approveDocumentRevision(result.document.id, String(proposal.revision.id));
    expect((await repository.getDocument(result.document.id))?.markdown).toContain("# HEADING");
  });
});
