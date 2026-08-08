"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, Bot, Check, CirclePause, FileText, Loader2,
  MessageSquareText, Pause, Play, RefreshCw, Search, Send, SlidersHorizontal, X
} from "lucide-react";
import type { Project } from "@/lib/domain";

type Strategy = {
  id: string; version: number; title: string; summary: string; status: string;
  strategy: {
    geographicScope: string[]; industries: string[]; targetProfile: string;
    exclusions: string[]; qualificationRules: string[]; sourcePlan: string[];
    queryFamilies: string[]; requiredDossierSections: string[];
    evidenceStandard: string; newsFreshnessDays: number;
  };
};
type Message = { id: string; role: string; content: string; strategyVersionId: string | null; createdAt: string };
type Settings = {
  dossierWorkerLimit: number; revisionWorkerLimit: number; queueBufferTarget: number;
  discoveryEnabled: boolean; researchPaused: boolean; activeStrategyVersionId: string | null;
};
type Candidate = {
  id: string; campaignId: string; data: Record<string, unknown>; priority: number;
  qualificationScore: number | null; queueStatus: string; dossierStatus: string;
  dossierReason: string | null; disposition: string; strategyVersionId: string | null;
  linkedDocumentId: string | null; updatedAt: string;
};
type Dossier = { id: string; title: string; filename: string; sourceKind: string; wordCount: number; updatedAt: string };
type Workspace = {
  settings: Settings; strategies: Strategy[]; messages: Message[]; candidates: Candidate[];
  documents: Dossier[]; projectDocuments: Dossier[]; campaigns: Array<{ id: string; name: string; status: string }>;
  revisionRequests: Array<{ id: string; documentId: string; status: string; instruction: string; createdAt: string }>;
};
type Tab = "strategy" | "queue" | "dossiers";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Request failed.");
  return payload;
}

export function ResearchProjectWorkspace({
  project, onError, onOpenDocument
}: {
  project: Project;
  onError: (message: string) => void;
  onOpenDocument: (documentId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("strategy");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const payload = await json<{ data: Workspace }>(`/api/v1/projects/${project.id}/research-workspace`);
    setWorkspace(payload.data);
  }, [project.id]);

  useEffect(() => {
    setLoading(true);
    load().catch((error: Error) => onError(error.message)).finally(() => setLoading(false));
  }, [load, onError]);

  useEffect(() => {
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void load().catch(() => undefined);
    }, 7500);
    return () => window.clearInterval(refresh);
  }, [load]);

  if (loading || !workspace) {
    return <div className="loading-state research-loading"><Loader2 className="spin" size={20} /> Loading research workspace</div>;
  }

  const activeCount = workspace.candidates.filter((item) => item.dossierStatus === "researching").length;
  const queuedCount = workspace.candidates.filter((item) => item.queueStatus === "queued" && item.dossierStatus === "pending").length;
  const readyCount = workspace.documents.length;

  return (
    <div className="research-workspace">
      <header className="research-project-head">
        <div>
          <span className="eyebrow">Continuous client research</span>
          <h2>{project.name}</h2>
          <p>{project.objective}</p>
        </div>
        <div className="research-head-status">
          <span className={`pill ${workspace.settings.researchPaused ? "warn" : "good"}`}>
            {workspace.settings.researchPaused ? "Paused" : "Running"}
          </span>
          <button
            className="secondary"
            disabled={busy === "pause"}
            onClick={async () => {
              setBusy("pause");
              try {
                await json(`/api/v1/projects/${project.id}/research-settings`, {
                  method: "PATCH", body: JSON.stringify({ researchPaused: !workspace.settings.researchPaused })
                });
                if (workspace.settings.researchPaused) {
                  await json(`/api/v1/projects/${project.id}/research-dispatch`, { method: "POST" });
                }
                await load();
              } catch (error) { onError(error instanceof Error ? error.message : "Could not update research."); }
              finally { setBusy(null); }
            }}
          >
            {workspace.settings.researchPaused ? <Play size={14} /> : <Pause size={14} />}
            {workspace.settings.researchPaused ? "Resume research" : "Pause research"}
          </button>
        </div>
      </header>

      <div className="research-summary" aria-label="Research project summary">
        <Summary label="Active dossiers" value={`${activeCount} / ${workspace.settings.dossierWorkerLimit}`} />
        <Summary label="Qualified queue" value={String(queuedCount)} />
        <Summary label="Dossiers" value={String(readyCount)} />
        <Summary label="Strategy" value={workspace.strategies.find((item) => item.status === "active") ? `v${workspace.strategies.find((item) => item.status === "active")?.version}` : "Not approved"} />
      </div>

      <nav className="research-tabs" aria-label="Research project views">
        <TabButton active={tab === "strategy"} onClick={() => setTab("strategy")} icon={MessageSquareText} label="Strategy" />
        <TabButton active={tab === "queue"} onClick={() => setTab("queue")} icon={SlidersHorizontal} label="Research queue" count={workspace.candidates.length} />
        <TabButton active={tab === "dossiers"} onClick={() => setTab("dossiers")} icon={FileText} label="Dossiers" count={workspace.documents.length} />
      </nav>

      {tab === "strategy" && <StrategyView projectId={project.id} workspace={workspace} load={load} busy={busy} setBusy={setBusy} onError={onError} />}
      {tab === "queue" && <QueueView projectId={project.id} workspace={workspace} load={load} busy={busy} setBusy={setBusy} onError={onError} onOpenDocument={onOpenDocument} />}
      {tab === "dossiers" && <DossiersView projectId={project.id} workspace={workspace} load={load} busy={busy} setBusy={setBusy} onError={onError} onOpenDocument={onOpenDocument} />}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function TabButton({ active, onClick, icon: Icon, label, count }: {
  active: boolean; onClick: () => void; icon: typeof Bot; label: string; count?: number;
}) {
  return (
    <button className={active ? "active" : ""} aria-selected={active} role="tab" onClick={onClick}>
      <Icon size={15} /> {label}{count !== undefined && <span>{count}</span>}
    </button>
  );
}

function StrategyView({ projectId, workspace, load, busy, setBusy, onError }: {
  projectId: string; workspace: Workspace; load: () => Promise<void>; busy: string | null;
  setBusy: (value: string | null) => void; onError: (message: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const active = workspace.strategies.find((item) => item.status === "active") ?? null;
  const proposed = workspace.strategies.find((item) => item.status === "proposed") ?? null;

  async function send() {
    if (!instruction.trim()) return;
    setBusy("strategy");
    try {
      await json(`/api/v1/projects/${projectId}/strategy/messages`, {
        method: "POST", body: JSON.stringify({ instruction })
      });
      setInstruction("");
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : "The strategist could not respond."); }
    finally { setBusy(null); }
  }

  async function activate(id: string) {
    setBusy("activate");
    try {
      await json(`/api/v1/projects/${projectId}/strategy/${id}/activate`, { method: "POST" });
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Could not activate strategy."); }
    finally { setBusy(null); }
  }

  return (
    <div className="strategy-layout">
      <section className="surface strategy-conversation">
        <div className="surface-header"><h2>Research strategist</h2><span>Premium model · stays available while workers run</span></div>
        <div className="strategy-messages">
          {workspace.messages.length === 0 ? (
            <div className="strategy-empty">
              <Bot size={24} />
              <strong>Build the first research strategy</strong>
              <p>Describe the market, geography, company profile, exclusions, and what a useful dossier must answer.</p>
            </div>
          ) : workspace.messages.map((message) => (
            <article key={message.id} className={`strategy-message ${message.role}`}>
              <span>{message.role === "user" ? "You" : "Strategist"}</span>
              <p>{message.content}</p>
            </article>
          ))}
        </div>
        <div className="strategy-composer">
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Rethink the strategy, narrow the geography, add qualification rules, or change the dossier requirements…"
            rows={4}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void send();
            }}
          />
          <div><span>⌘ Enter to send</span><button className="primary" disabled={busy === "strategy" || !instruction.trim()} onClick={() => void send()}>
            {busy === "strategy" ? <Loader2 className="spin" size={14} /> : <Send size={14} />} Ask strategist
          </button></div>
        </div>
      </section>

      <aside className="strategy-panel">
        <div className="strategy-rollout-note">Approved changes apply to queued companies and the next batch. Workers already researching a company finish with the strategy version they claimed.</div>
        {proposed && (
          <StrategyCard strategy={proposed} title="Proposed strategy" action={
            <button className="primary" disabled={busy === "activate"} onClick={() => void activate(proposed.id)}>
              <Check size={14} /> Approve and apply
            </button>
          } />
        )}
        {active ? <StrategyCard strategy={active} title="Active strategy" /> : (
          <section className="surface strategy-card"><div className="empty-inline">No strategy has been approved.</div></section>
        )}
      </aside>
    </div>
  );
}

function StrategyCard({ strategy, title, action }: { strategy: Strategy; title: string; action?: React.ReactNode }) {
  const sections = [
    ["Geography", strategy.strategy.geographicScope], ["Industries", strategy.strategy.industries],
    ["Qualification", strategy.strategy.qualificationRules], ["Exclusions", strategy.strategy.exclusions],
    ["Sources", strategy.strategy.sourcePlan]
  ] as const;
  return (
    <section className="surface strategy-card">
      <div className="surface-header"><h2>{title}</h2><span>Version {strategy.version}</span></div>
      <div className="strategy-card-body">
        <h3>{strategy.title}</h3><p>{strategy.summary}</p>
        <div className="strategy-target"><span>Target profile</span><p>{strategy.strategy.targetProfile}</p></div>
        {sections.map(([label, values]) => values.length > 0 && (
          <div className="strategy-field" key={label}><span>{label}</span><ul>{values.map((value) => <li key={value}>{value}</li>)}</ul></div>
        ))}
        {action}
      </div>
    </section>
  );
}

function QueueView({ projectId, workspace, load, busy, setBusy, onError, onOpenDocument }: {
  projectId: string; workspace: Workspace; load: () => Promise<void>; busy: string | null;
  setBusy: (value: string | null) => void; onError: (message: string) => void;
  onOpenDocument: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => workspace.candidates.filter((candidate) =>
    Object.values(candidate.data).some((value) => String(value).toLowerCase().includes(filter.toLowerCase()))
  ), [workspace.candidates, filter]);

  async function settings(change: Partial<Settings>) {
    setBusy("settings");
    try {
      await json(`/api/v1/projects/${projectId}/research-settings`, { method: "PATCH", body: JSON.stringify(change) });
      if (change.dossierWorkerLimit !== undefined || change.researchPaused === false) {
        await json(`/api/v1/projects/${projectId}/research-dispatch`, { method: "POST" });
      }
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Could not update workers."); }
    finally { setBusy(null); }
  }

  async function candidate(id: string, change: Record<string, unknown>) {
    setBusy(id);
    try {
      await json(`/api/v1/projects/${projectId}/research-candidates/${id}`, { method: "PATCH", body: JSON.stringify(change) });
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Could not update candidate."); }
    finally { setBusy(null); }
  }

  return (
    <div className="queue-view">
      <section className="queue-controls surface">
        <div className="queue-control-main">
          <div><span>Dossier workers</span><strong>{workspace.settings.dossierWorkerLimit}</strong></div>
          <button aria-label="Decrease workers" disabled={busy === "settings" || workspace.settings.dossierWorkerLimit <= 1} onClick={() => void settings({ dossierWorkerLimit: workspace.settings.dossierWorkerLimit - 1 })}>−</button>
          <button aria-label="Increase workers" disabled={busy === "settings" || workspace.settings.dossierWorkerLimit >= 10} onClick={() => void settings({ dossierWorkerLimit: workspace.settings.dossierWorkerLimit + 1 })}>+</button>
        </div>
        <label><span>Queue buffer</span><input type="number" min={1} max={100} value={workspace.settings.queueBufferTarget} onChange={(event) => void settings({ queueBufferTarget: Number(event.target.value) })} /></label>
        <button className="secondary" disabled={busy === "settings"} onClick={() => void settings({ discoveryEnabled: !workspace.settings.discoveryEnabled })}>
          {workspace.settings.discoveryEnabled ? <CirclePause size={14} /> : <Search size={14} />}
          {workspace.settings.discoveryEnabled ? "Pause discovery" : "Resume discovery"}
        </button>
        <button className="primary" disabled={busy === "dispatch"} onClick={async () => {
          setBusy("dispatch");
          try { await json(`/api/v1/projects/${projectId}/research-dispatch`, { method: "POST" }); await load(); }
          catch (error) { onError(error instanceof Error ? error.message : "Could not start queued research."); }
          finally { setBusy(null); }
        }}><Play size={14} /> Research queued</button>
        <label className="queue-search"><Search size={14} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter companies" /></label>
      </section>

      <section className="surface queue-table-wrap">
        {visible.length === 0 ? <div className="empty-inline">No companies are in the research queue yet.</div> : (
          <table className="data-table research-queue-table">
            <thead><tr><th>Company</th><th>Qualification</th><th>Priority</th><th>Research</th><th>Decision</th><th /></tr></thead>
            <tbody>{visible.map((item) => {
              const name = companyName(item.data);
              return (
                <tr key={item.id}>
                  <td><strong>{name}</strong><span>{companyDetail(item.data)}</span></td>
                  <td>{item.qualificationScore ?? "—"}</td>
                  <td><div className="priority-control"><button onClick={() => void candidate(item.id, { priority: item.priority - 1 })}><ArrowDown size={13} /></button><strong>{item.priority}</strong><button onClick={() => void candidate(item.id, { priority: item.priority + 1 })}><ArrowUp size={13} /></button></div></td>
                  <td><span className={`pill ${item.dossierStatus === "completed" ? "good" : item.dossierStatus === "failed" ? "crit" : ""}`}>{item.queueStatus === "held" ? "held" : item.dossierStatus}</span>{item.dossierReason && <small>{item.dossierReason}</small>}</td>
                  <td><select value={item.disposition} onChange={(event) => void candidate(item.id, { disposition: event.target.value })}><option value="unreviewed">Unreviewed</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="needs_revision">Needs revision</option></select></td>
                  <td><div className="row-actions"><button className="quiet" onClick={() => void candidate(item.id, { held: item.queueStatus !== "held" })}>{item.queueStatus === "held" ? <Play size={13} /> : <Pause size={13} />}{item.queueStatus === "held" ? "Resume" : "Hold"}</button>{item.linkedDocumentId && <button className="quiet" onClick={() => onOpenDocument(item.linkedDocumentId as string)}><FileText size={13} /> Open</button>}</div></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function DossiersView({ projectId, workspace, load, busy, setBusy, onError, onOpenDocument }: {
  projectId: string; workspace: Workspace; load: () => Promise<void>; busy: string | null;
  setBusy: (value: string | null) => void; onError: (message: string) => void;
  onOpenDocument: (id: string) => void;
}) {
  const [selected, setSelected] = useState(workspace.documents[0]?.id ?? null);
  const [feedback, setFeedback] = useState("");
  const [questions, setQuestions] = useState("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [bin, setBin] = useState<"all" | "approved" | "declined" | "unreviewed" | "needs_revision">("all");
  const visibleDocuments = workspace.documents.filter((item) => {
    if (bin === "all") return true;
    return workspace.candidates.find((candidate) => candidate.linkedDocumentId === item.id)?.disposition === bin;
  });
  const document = visibleDocuments.find((item) => item.id === selected) ?? visibleDocuments[0];
  const requests = workspace.revisionRequests.filter((item) => item.documentId === document?.id);

  async function rework() {
    if (!document || !feedback.trim()) return;
    setBusy("rework");
    try {
      await json(`/api/v1/projects/${projectId}/dossiers/${document.id}/revision-requests`, {
        method: "POST", body: JSON.stringify({
          instruction: feedback,
          questions: questions.split("\n").map((item) => item.trim()).filter(Boolean),
          attachmentDocumentIds: attachmentIds
        })
      });
      setFeedback(""); setQuestions(""); setAttachmentIds([]); await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Could not request rework."); }
    finally { setBusy(null); }
  }

  if (workspace.documents.length === 0) return <div className="empty-module"><FileText size={24} /><h2>No dossiers yet</h2><p>Completed company research will appear here as editable master documents.</p></div>;
  return (
    <div className="dossier-library">
      <aside className="surface dossier-list"><div className="surface-header"><h2>Project dossiers</h2><span>{workspace.documents.length}</span></div><select value={bin} onChange={(event) => setBin(event.target.value as typeof bin)}><option value="all">All dossiers</option><option value="unreviewed">To review</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="needs_revision">Needs revision</option></select>{visibleDocuments.map((item) => <button key={item.id} className={item.id === document?.id ? "active" : ""} onClick={() => setSelected(item.id)}><FileText size={15} /><span><strong>{item.title}</strong><small>{item.wordCount.toLocaleString()} words</small></span></button>)}{visibleDocuments.length === 0 && <div className="empty-inline">No dossiers in this bin.</div>}</aside>
      {document ? <><section className="surface dossier-preview">
        <div className="dossier-preview-head"><div><span className="eyebrow">Master company file</span><h2>{document.title}</h2><p>Updated {new Date(document.updatedAt).toLocaleString()}</p></div><button className="primary" onClick={() => onOpenDocument(document.id)}><FileText size={14} /> Open full document</button></div>
        <div className="dossier-preview-body"><FileText size={32} /><h3>Open the full dossier to read or edit it</h3><p>Manual saves create immutable versions. Agent rework below creates a proposed version without replacing your current document.</p></div>
      </section>
      <aside className="surface dossier-feedback"><div className="surface-header"><h2>Feedback & rework</h2><span>Separate queue</span></div><div className="dossier-feedback-body"><p>Ask a dossier agent to investigate missing information, answer questions, or rewrite sections. This does not use a primary dossier-worker slot.</p><textarea rows={5} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Add recent hiring activity and investigate the Busan expansion…" /><label><span>Questions (one per line)</span><textarea rows={3} value={questions} onChange={(event) => setQuestions(event.target.value)} placeholder="Who leads procurement?&#10;What changed in the last 90 days?" /></label>{workspace.projectDocuments.length > 1 && <fieldset className="dossier-attachments"><legend>Attach project documents</legend>{workspace.projectDocuments.filter((item) => item.id !== document.id).map((item) => <label key={item.id}><input type="checkbox" checked={attachmentIds.includes(item.id)} onChange={(event) => setAttachmentIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /> {item.title}</label>)}</fieldset>}<button className="primary" disabled={!feedback.trim() || busy === "rework"} onClick={() => void rework()}>{busy === "rework" ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />} Create proposed version</button>{requests.length > 0 && <div className="revision-request-list"><h3>Revision requests</h3>{requests.map((request) => <div key={request.id}><span className={`pill ${request.status === "completed" ? "good" : ""}`}>{request.status}</span><p>{request.instruction}</p></div>)}</div>}</div></aside></> : <section className="surface dossier-preview"><div className="empty-inline">No dossiers in this bin.</div></section>}
    </div>
  );
}

function companyName(data: Record<string, unknown>) {
  const keys = ["companyName", "legalName", "name", "Company", "Company Name"];
  for (const key of keys) if (typeof data[key] === "string" && data[key]) return String(data[key]);
  return String(Object.values(data).find((value) => typeof value === "string") ?? "Unnamed company");
}

function companyDetail(data: Record<string, unknown>) {
  return [data.location, data.industry, data.website].filter(Boolean).map(String).join(" · ");
}
