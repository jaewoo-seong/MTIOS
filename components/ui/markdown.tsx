"use client";

import { useMemo } from "react";
import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

/**
 * Renders converted document markdown. Uploaded files are untrusted input, so the
 * generated HTML is always sanitized before it reaches the DOM.
 */
export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => {
    const parsed = marked.parse(source ?? "", { async: false }) as string;
    return DOMPurify.sanitize(parsed, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "form", "input", "iframe", "object", "embed"],
      FORBID_ATTR: ["style", "srcset", "formaction"]
    });
  }, [source]);

  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
