"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Database, FileText, FolderKanban, ListChecks, Loader2, Search } from "lucide-react";
import type { SearchHit, SearchKind } from "@/lib/domain";
import { useI18n } from "@/lib/i18n";

const KIND_LABEL: Record<SearchKind, string> = {
  project: "Projects",
  agenda: "Agendas",
  document: "Documents",
  knowledge: "Knowledge",
  database: "Client data"
};

const KIND_ICON: Record<SearchKind, typeof FileText> = {
  project: FolderKanban,
  agenda: ListChecks,
  document: FileText,
  knowledge: BookOpen,
  database: Database
};

const ORDER: SearchKind[] = ["project", "agenda", "document", "knowledge", "database"];

export function SearchPalette({
  onClose, onSelect
}: {
  onClose: () => void;
  onSelect: (hit: SearchHit) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);

  // Debounced so typing does not fire a request per keystroke; the abort
  // controller drops responses for queries the operator has already replaced.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal
        });
        if (!response.ok) throw new Error("search failed");
        const payload = (await response.json()) as { data: SearchHit[] };
        setHits(payload.data);
        setCursor(0);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setHits([]);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const grouped = useMemo(() => {
    const flat: SearchHit[] = [];
    const groups: Array<{ kind: SearchKind; items: SearchHit[] }> = [];
    for (const kind of ORDER) {
      const items = hits.filter((hit) => hit.kind === kind);
      if (items.length === 0) continue;
      groups.push({ kind, items });
      flat.push(...items);
    }
    return { groups, flat };
  }, [hits]);

  useEffect(() => {
    listRef.current?.querySelector(".search-hit.cursor")?.scrollIntoView({ block: "nearest" });
  }, [cursor, grouped.flat.length]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (grouped.flat.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => (current + 1) % grouped.flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => (current - 1 + grouped.flat.length) % grouped.flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = grouped.flat[cursor];
      if (hit) onSelect(hit);
    }
  }

  return (
    <div
      className="search-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="search-panel" role="dialog" aria-modal="true" aria-label={t("Search workspace")}>
        <div className="search-field">
          {busy ? <Loader2 size={18} className="spin" aria-hidden /> : <Search size={18} aria-hidden />}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("Search projects, documents, agendas, knowledge…")}
            aria-label={t("Search query")}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="search-results" ref={listRef} role="listbox" aria-label={t("Search results")}>
          {query.trim().length < 2 ? (
            <p className="search-empty">{t("Type at least two characters.")}</p>
          ) : grouped.flat.length === 0 ? (
            <p className="search-empty">{busy ? t("Searching…") : t("No matches for “{query}”.", { query: query.trim() })}</p>
          ) : (
            grouped.groups.map((group) => (
              <div key={group.kind}>
                <div className="search-group">{t(KIND_LABEL[group.kind])}</div>
                {group.items.map((hit) => {
                  const index = grouped.flat.indexOf(hit);
                  const Icon = KIND_ICON[hit.kind];
                  return (
                    <button
                      key={`${hit.kind}-${hit.id}`}
                      className={index === cursor ? "search-hit cursor" : "search-hit"}
                      role="option"
                      aria-selected={index === cursor}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => onSelect(hit)}
                    >
                      <Icon size={15} aria-hidden />
                      <span className="search-hit-body">
                        <strong>{highlight(hit.title, query)}</strong>
                        <span>{highlight(hit.excerpt, query)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="search-foot">
          <span>{t("↑↓ navigate")}</span>
          <span>{t("↵ open")}</span>
          <span>{t("esc close")}</span>
        </div>
      </div>
    </div>
  );
}

/** Wraps each case-insensitive occurrence of the query in a <mark>. */
function highlight(text: string, query: string) {
  const needle = query.trim();
  if (needle.length < 2) return text;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  let from = 0;

  for (;;) {
    const at = lower.indexOf(target, from);
    if (at === -1) break;
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at}>{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  if (parts.length === 0) return text;
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}
