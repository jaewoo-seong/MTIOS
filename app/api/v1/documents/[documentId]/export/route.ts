import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { repository } from "@/lib/repository";
import { exportEditableDocument } from "@/lib/documents/intelligence";

import { guard } from "@/lib/api/guard";
/** Streams the converted document back as a download so the browser can save it directly. */
export const GET = guard<{ documentId: string }>(async (request, { params }) => {
  const { documentId } = params;
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
  if (format === "csv") {
    const csv = firstMarkdownTableAsCsv(document.markdown);
    if (!csv) {
      return NextResponse.json({
        error: "no_table",
        detail: "This document has no Markdown table to export."
      }, { status: 409 });
    }
    return download(csv, `${base}.csv`, "text/csv; charset=utf-8");
  }
  if (format === "pdf" || format === "docx") {
    try {
      const body = await exportEditableDocument({
        title: document.title,
        markdown: document.markdown,
        format
      });
      return download(
        body,
        `${base}.${format}`,
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    } catch (error) {
      return NextResponse.json({
        error: "export_failed",
        detail: error instanceof Error ? error.message : "Document export failed."
      }, { status: 503 });
    }
  }
  if (format !== "md") {
    return NextResponse.json({
      error: "unsupported_format",
      detail: "Use md, txt, json, csv, pdf, or docx."
    }, { status: 400 });
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
});

function plural(count: number, noun: string) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function download(body: string | Buffer, filename: string, contentType: string) {
  return new NextResponse(typeof body === "string" ? body : new Uint8Array(body), {
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

function firstMarkdownTableAsCsv(markdown: string) {
  const table = (markdown.match(/(?:^\|.*\|\s*$\n?)+/gm) ?? [])[0];
  if (!table) return null;
  const rows = table.trim().split("\n")
    .filter((line) => !/^\|\s*(?:---+\s*\|)+$/.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function csvCell(value: string) {
  const unescaped = value.replace(/\\\|/g, "|");
  return /[",\r\n]/.test(unescaped) ? `"${unescaped.replace(/"/g, '""')}"` : unescaped;
}
