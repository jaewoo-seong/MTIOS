import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";

/** Streams the converted document back as a download so the browser can save it directly. */
export async function GET(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const document = await repository.getDocument(documentId);
  if (!document) return notFound("document");

  const format = new URL(request.url).searchParams.get("format") ?? "md";
  const base = document.filename.replace(/\.[^.]+$/, "") || "document";

  if (format === "txt") {
    return download(stripMarkdown(document.markdown), `${base}.txt`, "text/plain; charset=utf-8");
  }
  if (format === "json") {
    const payload = JSON.stringify({ ...document }, null, 2);
    return download(payload, `${base}.json`, "application/json; charset=utf-8");
  }
  if (format !== "md") {
    return NextResponse.json({ error: "unsupported_format", detail: "Use md, txt, or json." }, { status: 400 });
  }

  const header = [
    `# ${document.title}`,
    "",
    `> Source: ${document.filename} · ${document.sourceKind.toUpperCase()}` +
      (document.pageCount ? ` · ${plural(document.pageCount, "page")}` : "") +
      ` · ${plural(document.wordCount, "word")}`,
    ""
  ].join("\n");

  return download(`${header}\n${document.markdown}\n`, `${base}.md`, "text/markdown; charset=utf-8");
}

function plural(count: number, noun: string) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function download(body: string, filename: string, contentType: string) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "no-store"
    }
  });
}

function stripMarkdown(markdown: string) {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");
}
