"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Check, Download, Loader2, Pencil, RotateCcw, Search, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";

type ChangeItem = {
  id: string;
  operation: "insert" | "update" | "delete" | "merge";
  before: Record<string, string> | null;
  after: Record<string, string> | null;
  confidence: number;
  validationWarnings: string[];
  status: string;
};
type ChangeSet = {
  id: string;
  title: string;
  reason: string;
  status: string;
  revision: number;
  expiresAt: string;
  items: ChangeItem[];
};

export function ClientChangeReview({ projectId, onError }: {
  projectId: string;
  onError: (message: string) => void;
}) {
  const [sets, setSets] = useState<ChangeSet[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ set: ChangeSet; item: ChangeItem } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/v1/projects/${projectId}/client-change-sets`);
    if (!response.ok) throw new Error("Could not load client-data proposals.");
    const payload = (await response.json()) as { data: ChangeSet[] };
    setSets(payload.data);
    setSelected((current) => Object.fromEntries(payload.data.map((set) => [
      set.id,
      current[set.id] ?? set.items.filter((item) => item.status !== "rejected").map((item) => item.id)
    ])));
  }, [projectId]);

  useEffect(() => {
    load().catch((reason: Error) => onError(reason.message));
  }, [load, onError]);

  const pending = useMemo(
    () => sets.filter((set) => !["rolled_back"].includes(set.status)),
    [sets]
  );

  async function decide(set: ChangeSet, decision: "approved" | "rejected" | "needs_research") {
    setBusy(set.id);
    try {
      const response = await fetch(`/api/v1/client-change-sets/${set.id}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          selectedItemIds: selected[set.id] ?? [],
          note: ""
        })
      });
      const payload = (await response.json()) as {
        data?: { approvalToken: string | null };
        error?: string;
      };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Decision failed.");
      if (decision === "approved" && payload.data.approvalToken) {
        const applied = await fetch(`/api/v1/client-change-sets/${set.id}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalToken: payload.data.approvalToken })
        });
        const result = (await applied.json()) as { error?: string };
        if (!applied.ok) throw new Error(result.error ?? "Approved changes could not be applied.");
      }
      await load();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Decision failed.");
    } finally {
      setBusy(null);
    }
  }

  async function rollback(set: ChangeSet) {
    setBusy(set.id);
    try {
      const response = await fetch(`/api/v1/client-change-sets/${set.id}/rollback`, { method: "POST" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Rollback failed.");
      await load();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Rollback failed.");
    } finally {
      setBusy(null);
    }
  }

  async function revise(value: Record<string, string> | null) {
    if (!editing) return;
    setBusy(editing.set.id);
    try {
      const response = await fetch(`/api/v1/client-change-sets/${editing.set.id}/items/${editing.item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ after: value, note: "Edited during operator review." })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Proposal edit failed.");
      const submitted = await fetch(`/api/v1/client-change-sets/${editing.set.id}/submit`, { method: "POST" });
      const submission = (await submitted.json()) as { error?: string };
      if (!submitted.ok) throw new Error(submission.error ?? "Revised proposal could not be submitted.");
      setEditing(null);
      await load();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Proposal edit failed.");
    } finally {
      setBusy(null);
    }
  }

  if (pending.length === 0) return null;

  return (
    <section className="surface change-review">
      <div className="surface-header">
        <div><h2>Client-data proposals</h2><span>Review exact values before any database write</span></div>
        <span>{pending.length}</span>
      </div>
      <div className="change-set-list">
        {pending.map((set) => (
          <article className="change-set" key={set.id}>
            <header>
              <div>
                <strong>{set.title}</strong>
                {set.reason && <p>{set.reason}</p>}
              </div>
              <span className={`pill ${set.status === "applied" ? "good" : set.status === "conflict" ? "crit" : "warn"}`}>
                {set.status.replaceAll("_", " ")}
              </span>
            </header>
            <div className="change-items">
              {set.items.map((item) => {
                const checked = (selected[set.id] ?? []).includes(item.id);
                return (
                  <div className="change-item" key={item.id}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.operation} proposal`}
                      checked={checked}
                      disabled={set.status !== "review_required"}
                      onChange={() => setSelected((current) => ({
                        ...current,
                        [set.id]: checked
                          ? (current[set.id] ?? []).filter((id) => id !== item.id)
                          : [...(current[set.id] ?? []), item.id]
                      }))}
                    />
                    <span className="change-operation">{item.operation}</span>
                    <JsonValues label="Current" value={item.before} />
                    <JsonValues label="Proposed" value={item.after} />
                    <span className="change-confidence">{item.confidence}%</span>
                    {set.status === "review_required" && item.operation !== "delete" && (
                      <button
                        type="button"
                        className="icon-only change-edit"
                        aria-label="Edit proposed values"
                        title="Edit proposed values"
                        onClick={(event) => {
                          event.preventDefault();
                          setEditing({ set, item });
                        }}
                      >
                        <Pencil size={13} aria-hidden />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <footer>
              <a className="secondary" href={`/api/v1/client-change-sets/${set.id}/export`}>
                <Download size={14} aria-hidden /> Export
              </a>
              {set.status === "review_required" && (
                <>
                  <button className="secondary" disabled={busy === set.id} onClick={() => void decide(set, "needs_research")}>
                    <Search size={14} aria-hidden /> More research
                  </button>
                  <button className="secondary" disabled={busy === set.id} onClick={() => void decide(set, "rejected")}>
                    <X size={14} aria-hidden /> Reject
                  </button>
                  <button className="primary" disabled={busy === set.id || (selected[set.id]?.length ?? 0) === 0} onClick={() => void decide(set, "approved")}>
                    {busy === set.id ? <Loader2 size={14} className="spin" aria-hidden /> : <Check size={14} aria-hidden />}
                    Approve and apply
                  </button>
                </>
              )}
              {set.status === "applied" && (
                <button className="secondary" disabled={busy === set.id} onClick={() => void rollback(set)}>
                  <RotateCcw size={14} aria-hidden /> Roll back
                </button>
              )}
            </footer>
          </article>
        ))}
      </div>
      {editing && (
        <ProposalEditor
          item={editing.item}
          busy={busy === editing.set.id}
          onSave={(value) => void revise(value)}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function JsonValues({ label, value }: { label: string; value: Record<string, string> | null }) {
  return (
    <span className="change-values">
      <small>{label}</small>
      {value
        ? Object.entries(value).map(([key, item]) => <span key={key}><b>{key}</b>{item}</span>)
        : <span>None</span>}
    </span>
  );
}

function ProposalEditor({ item, busy, onSave, onClose }: {
  item: ChangeItem;
  busy: boolean;
  onSave: (value: Record<string, string> | null) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [value, setValue] = useState(JSON.stringify(item.after, null, 2));
  const [error, setError] = useState("");

  return (
    <Modal labelledBy={titleId} onClose={onClose} className="dialog dialog-sm" dismissOnBackdrop={false}>
      <form onSubmit={(event) => {
        event.preventDefault();
        try {
          const parsed = JSON.parse(value) as unknown;
          if (parsed !== null && (
            typeof parsed !== "object" ||
            Array.isArray(parsed) ||
            Object.values(parsed).some((entry) => typeof entry !== "string")
          )) throw new Error("Use a JSON object with string values.");
          onSave(parsed as Record<string, string> | null);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "Invalid JSON.");
        }
      }}>
        <div className="dialog-head"><h2 id={titleId}>Edit proposed values</h2></div>
        <label className="field">
          Record JSON
          <textarea rows={12} value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" disabled={busy}>
            {busy && <Loader2 size={14} className="spin" aria-hidden />} Save revision
          </button>
        </div>
      </form>
    </Modal>
  );
}
