import mammoth from "mammoth";
import JSZip from "jszip";
import TurndownService from "turndown";

export type SourceKind = "pdf" | "docx" | "html" | "csv" | "markdown" | "text" | "json" | "unknown";

export interface ConversionResult {
  title: string;
  markdown: string;
  kind: SourceKind;
  pageCount: number | null;
  wordCount: number;
  truncated: boolean;
}

/** Guard against a single upload exhausting memory or the model context downstream. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_MARKDOWN_CHARS = 400_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;
const MAX_DOCX_PARAGRAPHS = 5_000;
const MAX_DOCX_TABLES = 30;
const MAX_DOCX_IMAGES = 8;

export const DOCUMENT_ACCEPT = ".txt,.md,.markdown,.docx";

export type DocumentPreflight = {
  kind: "text" | "markdown" | "docx";
  warnings: string[];
};

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-"
});
turndown.remove(["script", "style", "noscript"]);

export function detectKind(filename: string, mimeType: string): SourceKind {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (extension === "docx" || mimeType.includes("wordprocessingml")) return "docx";
  if (extension === "html" || extension === "htm" || mimeType.includes("html")) return "html";
  if (extension === "csv" || extension === "tsv" || mimeType.includes("csv")) return "csv";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "json" || mimeType.includes("json")) return "json";
  if (extension === "txt" || mimeType.startsWith("text/")) return "text";
  return "unknown";
}

/**
 * The import boundary deliberately accepts only formats that can be converted
 * deterministically without OCR, browser engines, macros, or embedded objects.
 */
export async function preflightDocument(
  filename: string,
  mimeType: string,
  buffer: Buffer
): Promise<DocumentPreflight> {
  if (!buffer.length) throw new Error("File is empty.");
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB upload limit.`);
  }
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (extension === "pdf" || mimeType === "application/pdf") {
    throw new Error("PDF importing is not available yet. Upload text, Markdown, or a simple DOCX file.");
  }
  if (extension === "doc" || extension === "docm") {
    throw new Error("Legacy or macro-enabled Word files are not supported. Save a simple .docx file first.");
  }
  if (["txt", "md", "markdown"].includes(extension)) {
    const text = decodePlainText(buffer);
    if (text.includes("\u0000")) throw new Error("This file appears to contain binary data, not plain text.");
    return { kind: extension === "txt" ? "text" : "markdown", warnings: [] };
  }
  if (extension !== "docx" && !mimeType.includes("wordprocessingml")) {
    throw new Error("Unsupported file type. Upload text, Markdown, or a simple DOCX file.");
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("The Word file is not a valid DOCX package.");
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  } catch {
    throw new Error("The Word file is corrupt, encrypted, or not a valid DOCX package.");
  }
  const names = Object.keys(zip.files);
  if (!zip.file("word/document.xml")) throw new Error("The DOCX file has no readable document body.");
  if (names.some((name) => /vbaProject|activeX|embeddings|oleObject/i.test(name))) {
    throw new Error("This Word file contains macros, embedded objects, or active content and cannot be imported safely.");
  }
  const imageCount = names.filter((name) => /^word\/media\//i.test(name) && !zip.files[name].dir).length;
  if (imageCount > MAX_DOCX_IMAGES) {
    throw new Error(`This Word file is too media-heavy (${imageCount} images). The current limit is ${MAX_DOCX_IMAGES}.`);
  }
  let uncompressedBytes = 0;
  for (const name of names) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const content = await entry.async("uint8array");
    uncompressedBytes += content.byteLength;
    if (uncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw new Error("The expanded Word file is too large to convert safely.");
    }
  }
  const xml = await zip.file("word/document.xml")!.async("string");
  const paragraphs = (xml.match(/<w:p(?:\s|>)/g) ?? []).length;
  const tables = (xml.match(/<w:tbl(?:\s|>)/g) ?? []).length;
  if (paragraphs > MAX_DOCX_PARAGRAPHS || tables > MAX_DOCX_TABLES) {
    throw new Error("This Word file is too structurally complex for the simple DOCX importer.");
  }
  if (/<w:(?:ins|del)(?:\s|>)/.test(xml)) {
    throw new Error("Accept or reject tracked changes in Word before importing this document.");
  }
  const extracted = await mammoth.extractRawText({ buffer });
  if (extracted.value.trim().length < 20) {
    throw new Error("The Word file does not contain enough directly extractable text.");
  }
  return {
    kind: "docx",
    warnings: imageCount > 0 ? ["Embedded images are omitted; only directly readable text and tables are imported."] : []
  };
}

function decodePlainText(buffer: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("Text and Markdown files must use UTF-8 encoding.");
  }
}

export function titleFromFilename(filename: string) {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  if (!base) return "Untitled document";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export async function convertToMarkdown(
  filename: string,
  mimeType: string,
  buffer: Buffer
): Promise<ConversionResult> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB upload limit.`);
  }

  const preflight = await preflightDocument(filename, mimeType, buffer);
  const kind = preflight.kind;
  let markdown = "";
  let pageCount: number | null = null;

  switch (kind) {
    case "docx": {
      const { value } = await mammoth.convertToHtml({ buffer });
      markdown = turndown.turndown(value);
      break;
    }
    case "markdown": {
      markdown = buffer.toString("utf8");
      break;
    }
    case "text": {
      markdown = normalizeExtractedText(buffer.toString("utf8"));
      break;
    }
    default:
      throw new Error("Unsupported file type. Upload text, Markdown, or a simple DOCX file.");
  }

  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();
  if (!markdown) {
    markdown = "_No extractable text content was found in this file._";
  }

  const truncated = markdown.length > MAX_MARKDOWN_CHARS;
  if (truncated) {
    markdown = `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n_[Content truncated at ${MAX_MARKDOWN_CHARS.toLocaleString()} characters.]_`;
  }

  return {
    title: firstHeading(markdown) ?? titleFromFilename(filename),
    markdown,
    kind,
    pageCount,
    wordCount: countWords(markdown),
    truncated
  };
}

/** PDF and plain-text extraction emit hard-wrapped lines; rejoin them into paragraphs. */
function normalizeExtractedText(input: string) {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph = "";
  // Set when the previous line ended mid-word, so the next one joins with no space.
  let joinTight = false;

  const flush = () => {
    const text = paragraph.replace(/\s+/g, " ").trim();
    if (text) out.push(text);
    paragraph = "";
    joinTight = false;
  };

  const append = (text: string) => {
    if (!paragraph) paragraph = text;
    else paragraph += joinTight ? text : ` ${text}`;
    joinTight = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    // Preserve list items and existing headings as their own blocks.
    if (/^(#{1,6}\s|[-*•]\s|\d+[.)]\s)/.test(line)) {
      flush();
      out.push(line.replace(/^•\s/, "- "));
      continue;
    }
    // A trailing hyphen means a word was split across the line break.
    if (/[A-Za-z]-$/.test(line)) {
      append(line.slice(0, -1));
      joinTight = true;
      continue;
    }
    append(line);
  }
  flush();
  return out.join("\n\n");
}

function delimitedToMarkdownTable(input: string, delimiter: string) {
  const rows = parseDelimited(input, delimiter).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) return "";

  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) =>
    Array.from({ length: width }, (_, index) => escapeCell(row[index] ?? ""));

  const [header, ...body] = rows;
  const lines = [
    `| ${pad(header).join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${pad(row).join(" | ")} |`)
  ];
  return lines.join("\n");
}

/** Minimal RFC-4180 reader: handles quoted fields, escaped quotes, and embedded newlines. */
function parseDelimited(input: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function safePrettyJson(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function firstHeading(markdown: string) {
  const match = markdown.match(/^#{1,3}\s+(.+)$/m);
  if (!match) return null;
  const heading = match[1].trim();
  // "## Page 1" is structural, not a real title.
  if (/^page\s+\d+$/i.test(heading)) return null;
  return heading.slice(0, 120);
}

function countWords(markdown: string) {
  const words = markdown.trim().match(/\S+/g);
  return words ? words.length : 0;
}
