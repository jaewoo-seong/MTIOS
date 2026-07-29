"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2
} from "lucide-react";
import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*"
});
// Turndown drops tables by default; markdown tables are the whole point for CSV imports.
turndown.addRule("table", {
  filter: "table",
  replacement: (_content, node) => serializeTable(node as HTMLTableElement)
});
turndown.addRule("underline", {
  filter: (node) => node.nodeName === "U",
  replacement: (content) => (content ? `<u>${content}</u>` : "")
});
// Turndown's default emits "-<3 spaces>" and indents continuation lines by four,
// which leaves whitespace-only lines between items. Emit conventional markdown.
turndown.addRule("listItem", {
  filter: "li",
  replacement: (content, node) => {
    const body = content.replace(/^\n+/, "").replace(/\n+$/, "").replace(/\n/g, "\n  ");
    const parent = node.parentNode as HTMLElement | null;
    let prefix = "- ";
    if (parent?.nodeName === "OL") {
      const start = Number(parent.getAttribute("start") ?? 1);
      prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
    }
    return `${prefix}${body}\n`;
  }
});

/** Collapses whitespace-only lines and excess blank runs left by conversion. */
function tidyMarkdown(markdown: string) {
  return markdown
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function markdownToHtml(markdown: string) {
  return DOMPurify.sanitize(marked.parse(markdown ?? "", { async: false }) as string, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "form", "input", "iframe", "object", "embed"],
    FORBID_ATTR: ["style", "srcset", "formaction"]
  });
}

interface DocumentEditorProps {
  markdown: string;
  onDirtyChange: (dirty: boolean) => void;
  /** Registers a getter the parent calls on save to pull the current markdown. */
  registerGetter: (getter: () => string) => void;
}

export function DocumentEditor({ markdown, onDirtyChange, registerGetter }: DocumentEditorProps) {
  const initialHtml = useMemo(() => markdownToHtml(markdown), [markdown]);
  // Compare against the round-tripped form, not the raw source. Turndown normalizes
  // spacing (blank line after a heading, list indentation), so a straight comparison
  // would report "unsaved changes" the instant the editor opens.
  const baseline = useMemo(() => tidyMarkdown(turndown.turndown(initialHtml)), [initialHtml]);
  const [, setTick] = useState(0);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer nofollow" } }
      }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      TableKit.configure({ table: { resizable: true } })
    ],
    content: initialHtml,
    editorProps: {
      attributes: { class: "doc-editor-surface", spellcheck: "true" }
    },
    onUpdate: ({ editor: instance }) => {
      onDirtyChange(tidyMarkdown(turndown.turndown(instance.getHTML())) !== baseline);
      setTick((value) => value + 1);
    },
    onSelectionUpdate: () => setTick((value) => value + 1)
  });

  useEffect(() => {
    if (editor) registerGetter(() => tidyMarkdown(turndown.turndown(editor.getHTML())));
  }, [editor, registerGetter]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    // Only allow schemes that cannot execute script when clicked.
    if (!/^(https?:|mailto:|#|\/)/i.test(url.trim())) {
      window.alert("Use an http(s), mailto, or relative link.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }, [editor]);

  if (!editor) return <div className="doc-editor-loading">Preparing editor…</div>;

  return (
    <div className="doc-editor">
      <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
        <Group>
          <Tool editor={editor} label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 size={15} /></Tool>
          <Tool editor={editor} label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 size={15} /></Tool>
        </Group>
        <Divider />
        <Group>
          <select
            className="doc-style-select"
            aria-label="Paragraph style"
            value={currentBlock(editor)}
            onChange={(event) => applyBlock(editor, event.target.value)}
          >
            <option value="paragraph">Body text</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="h4">Heading 4</option>
          </select>
        </Group>
        <Divider />
        <Group>
          <Tool editor={editor} label="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={15} /></Tool>
          <Tool editor={editor} label="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></Tool>
          <Tool editor={editor} label="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={15} /></Tool>
        </Group>
        <Divider />
        <Group>
          <Tool editor={editor} label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></Tool>
          <Tool editor={editor} label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></Tool>
          <Tool editor={editor} label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={15} /></Tool>
          <Tool editor={editor} label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></Tool>
          <Tool editor={editor} label="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}><Code size={15} /></Tool>
        </Group>
        <Divider />
        <Group>
          <Tool editor={editor} label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></Tool>
          <Tool editor={editor} label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></Tool>
          <Tool editor={editor} label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15} /></Tool>
          <Tool editor={editor} label="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={15} /></Tool>
        </Group>
        <Divider />
        <Group>
          <Tool editor={editor} label="Link" active={editor.isActive("link")} onClick={setLink}><Link2 size={15} /></Tool>
          <Tool
            editor={editor}
            label="Insert table"
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          ><TableIcon size={15} /></Tool>
        </Group>
      </div>

      <div className="doc-page-scroll">
        <div className="doc-page">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="doc-toolbar-group">{children}</div>;
}

function Divider() {
  return <span className="doc-toolbar-divider" aria-hidden />;
}

function Tool({
  label, onClick, active, disabled, children
}: {
  editor: Editor;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? "doc-tool active" : "doc-tool"}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
    </button>
  );
}

function currentBlock(editor: Editor) {
  for (const level of [1, 2, 3, 4] as const) {
    if (editor.isActive("heading", { level })) return `h${level}`;
  }
  return "paragraph";
}

function applyBlock(editor: Editor, value: string) {
  const chain = editor.chain().focus();
  if (value === "paragraph") chain.setParagraph().run();
  else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 }).run();
}

/** Emits a GitHub-flavoured markdown table, padding ragged rows to a fixed width. */
function serializeTable(table: HTMLTableElement) {
  const rows = [...table.rows].map((row) =>
    [...row.cells].map((cell) => (cell.textContent ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim())
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) => Array.from({ length: width }, (_, index) => row[index] ?? "");
  const [header, ...body] = rows;
  return [
    "",
    `| ${pad(header).join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${pad(row).join(" | ")} |`),
    ""
  ].join("\n");
}
