import mammoth from "mammoth";
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

  const kind = detectKind(filename, mimeType);
  let markdown = "";
  let pageCount: number | null = null;

  switch (kind) {
    case "pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { totalPages, text } = await extractText(pdf, { mergePages: false });
      pageCount = totalPages;
      markdown = text
        .map((page, index) => {
          const body = normalizeExtractedText(page);
          return body ? `## Page ${index + 1}\n\n${body}` : "";
        })
        .filter(Boolean)
        .join("\n\n");
      break;
    }
    case "docx": {
      const { value } = await mammoth.convertToHtml({ buffer });
      markdown = turndown.turndown(value);
      break;
    }
    case "html": {
      markdown = turndown.turndown(buffer.toString("utf8"));
      break;
    }
    case "csv": {
      markdown = delimitedToMarkdownTable(buffer.toString("utf8"), filename.endsWith(".tsv") ? "\t" : ",");
      break;
    }
    case "json": {
      const raw = buffer.toString("utf8");
      const pretty = safePrettyJson(raw);
      markdown = "```json\n" + pretty + "\n```";
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
      throw new Error(
        "Unsupported file type. Upload a PDF, DOCX, HTML, CSV, TSV, JSON, Markdown, or text file."
      );
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
