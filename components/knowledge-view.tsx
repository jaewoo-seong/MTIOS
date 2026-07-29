"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Check, Loader2, Plus, Trash2, X } from "lucide-react";
import type { KnowledgeEntry } from "@/lib/domain";
import { ConfirmDialog } from "@/components/ui/dialogs";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";

type Filter = "all" | KnowledgeEntry["status"];

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "proposed", label: "Proposed" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" }
];

export function KnowledgeView({ onError }: { onError: (message: string) => void }) {
  const { formatNumber, t } = useI18n();
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [filter, setFilter] = useState<Filter>("proposed");
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<KnowledgeEntry | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/knowledge");
    if (!response.ok) throw new Error("Could not load the knowledge base.");
    const payload = (await response.json()) as { data: KnowledgeEntry[] };
    setEntries(payload.data);
  }, []);

  useEffect(() => {
    load().catch((reason: Error) => onError(reason.message)).finally(() => setLoading(false));
  }, [load, onError]);

  const visible = useMemo(
    () => (filter === "all" ? entries : entries.filter((entry) => entry.status === filter)),
    [entries, filter]
  );

  const counts = useMemo(() => ({
    proposed: entries.filter((entry) => entry.status === "proposed").length,
    approved: entries.filter((entry) => entry.status === "approved").length,
    rejected: entries.filter((entry) => entry.status === "rejected").length,
    all: entries.length
  }), [entries]);

  async function setStatus(entry: KnowledgeEntry, status: KnowledgeEntry["status"]) {
    const previous = entries;
    setEntries((current) => current.map((item) => (item.id === entry.id ? { ...item, status } : item)));
    try {
      const response = await fetch(`/api/v1/knowledge/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (!response.ok) throw new Error("Could not update the entry.");
    } catch (reason) {
      setEntries(previous);
      onError(reason instanceof Error ? reason.message : "Could not update the entry.");
    }
  }

  async function remove(entry: KnowledgeEntry) {
    setPendingDelete(null);
    try {
      const response = await fetch(`/api/v1/knowledge/${entry.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete the entry.");
      await load();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not delete the entry.");
    }
  }

  if (loading) {
    return <div className="loading-state"><Loader2 size={20} className="spin" /><span>{t("Loading knowledge base")}</span></div>;
  }

  return (
    <div className="agent-view">
      <div className="surface-header" style={{ border: "1px solid var(--line)", borderRadius: "var(--r-md)", background: "var(--surface)" }}>
        <div className="surface-tools">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              className={filter === option.id ? "primary" : "quiet"}
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
            >
              {t(option.label)} <span className="data">{formatNumber(counts[option.id])}</span>
            </button>
          ))}
        </div>
        <button className="secondary" onClick={() => setComposing(true)}>
          <Plus size={14} aria-hidden /> {t("Propose memory")}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="empty-module">
          <div className="empty-icon"><BookOpen size={22} aria-hidden /></div>
          <h2>{t(filter === "proposed" ? "Nothing awaiting review" : "No entries here")}</h2>
          <p>
            {t("Approved memory is what the Executive Agent treats as established fact about MTI. Propose an entry, then approve it to put it into circulation.")}
          </p>
          <button className="primary" onClick={() => setComposing(true)}><Plus size={14} aria-hidden /> {t("Propose memory")}</button>
        </div>
      ) : (
        <div className="knowledge-list">
          {visible.map((entry) => (
            <article className="knowledge-card" key={entry.id}>
              <header>
                <h3>{entry.title}</h3>
                <span className={`pill ${entry.status === "approved" ? "good" : entry.status === "rejected" ? "crit" : "warn"}`}>
                  {t(entry.status)}
                </span>
              </header>
              <span className="label">{entry.collection}</span>
              <p>{entry.content}</p>
              <footer>
                {entry.source && <span className="knowledge-source">{entry.source}</span>}
                <div className="spacer" />
                {entry.status !== "approved" && (
                  <button className="secondary" onClick={() => void setStatus(entry, "approved")}>
                    <Check size={13} aria-hidden /> {t("Approve")}
                  </button>
                )}
                {entry.status !== "rejected" && (
                  <button className="quiet" onClick={() => void setStatus(entry, "rejected")}>
                    <X size={13} aria-hidden /> {t("Reject")}
                  </button>
                )}
                <button className="icon-only" onClick={() => setPendingDelete(entry)} aria-label={t("Delete {title}", { title: entry.title })} title={t("Delete {title}", { title: entry.title })}>
                  <Trash2 size={13} aria-hidden />
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}

      {composing && (
        <ComposeMemory
          onClose={() => setComposing(false)}
          onCreated={async () => {
            setComposing(false);
            setFilter("proposed");
            await load().catch((reason: Error) => onError(reason.message));
          }}
          onError={onError}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={t("Delete “{title}”?", { title: pendingDelete.title })}
          body={t("This removes the entry from organizational memory. This cannot be undone.")}
          confirmLabel={t("Delete entry")}
          destructive
          onConfirm={() => void remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function ComposeMemory({
  onClose, onCreated, onError
}: {
  onClose: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({ collection: "Operations", title: "", content: "", source: "" });
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/v1/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collection: form.collection.trim(),
          title: form.title.trim(),
          content: form.content.trim(),
          source: form.source.trim() || null
        })
      });
      if (!response.ok) throw new Error("Could not save the entry.");
      onCreated();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not save the entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy="compose-memory-title" onClose={onClose} className="dialog" dismissOnBackdrop={false}>
      <form onSubmit={submit}>
        <div className="dialog-head">
          <div>
            <span className="eyebrow">{t("New memory")}</span>
            <h2 id="compose-memory-title">{t("Propose an entry")}</h2>
            <p>{t("Entries enter as proposed and only become established fact once approved.")}</p>
          </div>
          <button type="button" className="icon-only" onClick={onClose} aria-label={t("Close dialog")}><X size={16} aria-hidden /></button>
        </div>
        <div className="form-grid">
          <label>{t("Collection")} <em>{t("required")}</em>
            <input required value={form.collection} onChange={(event) => setForm({ ...form, collection: event.target.value })} />
          </label>
          <label>{t("Source")}
            <input placeholder={t("Optional")} value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} />
          </label>
          <label className="span-2">{t("Title")} <em>{t("required")}</em>
            <input required minLength={2} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="span-2">{t("Content")} <em>{t("required")}</em>
            <textarea required minLength={2} rows={6} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} />
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>{t("Cancel")}</button>
          <button className="primary" disabled={busy}>{busy && <Loader2 size={13} className="spin" aria-hidden />}{t("Propose entry")}</button>
        </div>
      </form>
    </Modal>
  );
}
