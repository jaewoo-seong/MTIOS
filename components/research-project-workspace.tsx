"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, Bot, Check, CirclePause, Database, FileText, GalleryHorizontal, LayoutList, Loader2,
  MessageSquareText, Pause, Play, RefreshCw, RotateCcw, Search, Send, SlidersHorizontal, X
} from "lucide-react";
import type { Project } from "@/lib/domain";
import { evidenceCapabilityLabels, type EvidenceCapability } from "@/lib/research/evidence-capabilities";
import { truncateDossierSummary } from "@/lib/research/dossier-summary";
import { HelpLink } from "@/components/help-provider";

type Strategy = {
  id: string; version: number; title: string; summary: string; status: string;
  strategy: {
    geographicScope: string[]; industries: string[]; targetProfile: string;
    exclusions: string[]; qualificationRules: string[]; sourcePlan: string[];
    evidenceCapabilities?: EvidenceCapability[];
    queryFamilies: string[]; requiredDossierSections: string[];
    dossierResearchPlan?: Array<{ section: string; purpose: string; evidenceNeeded: string[]; priority: "required" | "supporting" }>;
    informationExclusions?: string[];
    evidenceStandard: string; newsFreshnessDays: number;
    targetCompanyCount: number; targetCompanyCountReason: string;
  };
};
type Message = { id: string; role: string; content: string; strategyVersionId: string | null; createdAt: string };
type Settings = {
  dossierWorkerLimit: number; revisionWorkerLimit: number; queueBufferTarget: number;
  queueBufferAutomatic: boolean;
  discoveryEnabled: boolean; researchPaused: boolean; activeStrategyVersionId: string | null;
  lastDiscoveryAt?: string | null;
};
type Candidate = {
  id: string; campaignId: string; data: Record<string, unknown>; priority: number;
  qualificationScore: number | null; queueStatus: string; dossierStatus: string;
  dossierReason: string | null; disposition: string; strategyVersionId: string | null;
  linkedDocumentId: string | null; updatedAt: string;
};
type Dossier = { id: string; title: string; filename: string; sourceKind: string; wordCount: number; summary: string; updatedAt: string };
type Workspace = {
  settings: Settings; strategies: Strategy[]; messages: Message[]; candidates: Candidate[];
  documents: Dossier[]; projectDocuments: Dossier[]; campaigns: Array<{ id: string; name: string; status: string; targetCount: number | null }>;
  clientDatabase: { id: string; name: string; recordCount: number } | null;
  revisionRequests: Array<{ id: string; documentId: string; status: string; instruction: string; createdAt: string }>;
  contextSnapshots: Array<{ id: string; candidateId: string; strategyVersionId: string | null; contentHash: string; createdAt: string }>;
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
  project, onError, onOpenDocument, onOpenDatabase, onOpenProjectDocuments
}: {
  project: Project;
  onError: (message: string) => void;
  onOpenDocument: (documentId: string) => void;
  onOpenDatabase: (databaseId: string) => void;
  onOpenProjectDocuments: (projectId: string) => void;
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
    // This is the operator's live view. The payload is summary-only, so keep
    // it fresh enough to expose claims, completions, and failures promptly.
    const refresh = window.setInterval(() => {
      if (document.visibilityState === "visible") void load().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(refresh);
  }, [load]);

  if (loading || !workspace) {
    return <div className="loading-state research-loading"><Loader2 className="spin" size={20} /> Loading research workspace</div>;
  }

  const activeCount = workspace.candidates.filter((item) => item.dossierStatus === "researching").length;
  const queuedCount = workspace.candidates.filter((item) => item.queueStatus === "queued" && item.dossierStatus === "pending").length;
  const readyCount = workspace.documents.length;
  // The active strategy governs every worker, so it stays visible from the
  // header rather than only inside the strategy tab.
  const activeStrategy = workspace.strategies.find((item) => item.status === "active");
  const failedCount = workspace.candidates.filter((item) => item.dossierStatus === "failed").length
    + workspace.revisionRequests.filter((item) => item.status === "failed").length
    + workspace.messages.filter((item) => item.role === "error").length;
  const projectState = !activeStrategy
    ? (workspace.strategies.some((item) => item.status === "proposed") ? "Waiting for strategy approval" : "Building strategy")
    : workspace.settings.researchPaused ? "Paused"
    : activeCount > 0 ? `Researching ${activeCount} dossier${activeCount === 1 ? "" : "s"}`
    : queuedCount > 0 ? "Dispatching queued research"
    : "Discovering companies";

  return (
    <div className="research-workspace">
      <header className="research-project-head">
        <div>
          <span className="eyebrow">Continuous client research</span>
          <h2>{project.name}</h2>
          <p>{project.objective}</p>
        </div>
        <div className="research-head-status">
          <span className={`pill ${failedCount ? "crit" : workspace.settings.researchPaused || !activeStrategy ? "warn" : "good"}`}>
            {projectState}
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

      <nav className="project-resource-links" aria-label="Linked project resources">
        <button onClick={() => workspace.clientDatabase && onOpenDatabase(workspace.clientDatabase.id)} disabled={!workspace.clientDatabase}>
          <Database size={18} />
          <span><strong>Client database</strong><small>{workspace.clientDatabase ? `${workspace.clientDatabase.name} · ${workspace.clientDatabase.recordCount} records` : "Database unavailable"}</small></span>
        </button>
        <button onClick={() => onOpenProjectDocuments(project.id)}>
          <FileText size={18} />
          <span><strong>Project documents</strong><small>{workspace.projectDocuments.length} linked documents</small></span>
        </button>
      </nav>

      <div className="research-summary" aria-label="Research project summary" data-help-anchor="research-summary">
        <Summary label="Active dossiers" value={`${activeCount} / ${workspace.settings.dossierWorkerLimit}`} />
        <Summary label="Qualified queue" value={String(queuedCount)} />
        <Summary label="Dossiers" value={String(readyCount)} />
        <Summary label="Company target" value={String(activeStrategy?.strategy.targetCompanyCount ?? "Not set")} />
        <Summary label="Strategy" value={activeStrategy ? `v${activeStrategy.version}` : "Not approved"} />
        <Summary label="Errors" value={String(failedCount)} />
      </div>

      <ResearchActivity workspace={workspace} state={projectState} />

      <nav className="research-tabs" aria-label="Research project views" data-help-anchor="research-tabs">
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

function ResearchActivity({ workspace, state }: { workspace: Workspace; state: string }) {
  const events = [
    ...workspace.messages.filter((item) => item.role === "error").map((item) => ({
      id: `message-${item.id}`, tone: "crit", title: "Strategist error", detail: item.content, at: item.createdAt
    })),
    ...workspace.candidates.filter((item) => item.dossierStatus === "researching" || item.dossierStatus === "failed").map((item) => ({
      id: `candidate-${item.id}`, tone: item.dossierStatus === "failed" ? "crit" : "active",
      title: item.dossierStatus === "failed" ? "Dossier failed" : "Dossier research in progress",
      detail: `${String(item.data.legalName ?? item.data.name ?? "Company")} · ${item.dossierReason ?? (item.dossierStatus === "researching" ? "Gathering and verifying evidence" : "No error detail was recorded")}`,
      at: item.updatedAt
    })),
    ...workspace.revisionRequests.filter((item) => item.status === "working" || item.status === "failed").map((item) => ({
      id: `revision-${item.id}`, tone: item.status === "failed" ? "crit" : "active",
      title: item.status === "failed" ? "Revision failed" : "Dossier revision in progress",
      detail: item.instruction, at: item.createdAt
    }))
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const spinning = state !== "Paused" && !state.startsWith("Waiting");
  return <section className="surface research-activity" aria-live="polite">
    <div className="surface-header"><h2>Live activity</h2><span>Refreshes every 4 seconds</span></div>
    <div className="research-activity-current"><Loader2 className={spinning ? "spin" : ""} size={16} /><div><strong>{state}</strong><small>{workspace.settings.lastDiscoveryAt ? `Last discovery ${new Date(workspace.settings.lastDiscoveryAt).toLocaleString()}` : "No discovery cycle has completed yet"}</small></div></div>
    {events.length > 0 ? <div className="research-activity-events">{events.map((event) => <article key={event.id} className={event.tone}><span>{event.title}</span><p>{event.detail}</p><time>{new Date(event.at).toLocaleString()}</time></article>)}</div> : <p className="research-activity-empty">No worker events yet. Strategy and research progress—or the exact recorded error—will appear here.</p>}
  </section>;
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
        <div className="surface-header"><h2>Research strategist <HelpLink article="strategy" title="How strategies work" /></h2><span>Premium model · stays available while workers run</span></div>
        <div className="strategy-messages">
          {workspace.messages.length === 0 ? (
            <div className="strategy-empty">
              <Bot size={24} />
              <strong>Build the first research strategy</strong>
              <p>Describe the market, geography, company profile, exclusions, and what a useful dossier must answer.</p>
            </div>
          ) : workspace.messages.map((message) => (
            <article key={message.id} className={`strategy-message ${message.role}`}>
              <span>{message.role === "user" ? "You" : message.role === "error" ? "Error" : "Strategist"}</span>
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
          <section className="surface strategy-card"><div className="empty-inline">No strategy has been approved. <HelpLink article="starting-a-project" label="How to start" /></div></section>
        )}
      </aside>
    </div>
  );
}

function StrategyCard({ strategy, title, action }: { strategy: Strategy; title: string; action?: React.ReactNode }) {
  const sections = [
    ["Geography", strategy.strategy.geographicScope], ["Industries", strategy.strategy.industries],
    ["Qualification", strategy.strategy.qualificationRules], ["Exclusions", strategy.strategy.exclusions],
    ["Sources", strategy.strategy.sourcePlan],
    ["Evidence coverage", (strategy.strategy.evidenceCapabilities ?? []).map((capability) => evidenceCapabilityLabels[capability])]
  ] as const;
  return (
    <section className="surface strategy-card">
      <div className="surface-header"><h2>{title} <HelpLink article="strategy" title="How strategies work" /></h2><span>Version {strategy.version}</span></div>
      <div className="strategy-card-body">
        <h3>{strategy.title}</h3><p>{strategy.summary}</p>
        {strategy.strategy.targetCompanyCount ? <div className="strategy-target"><span>Recommended company target</span><p><strong>{strategy.strategy.targetCompanyCount}</strong> companies · {strategy.strategy.targetCompanyCountReason}</p></div> : null}
        <div className="strategy-target"><span>Target profile</span><p>{strategy.strategy.targetProfile}</p></div>
        {sections.map(([label, values]) => values.length > 0 && (
          <div className="strategy-field" key={label}><span>{label}</span><ul>{values.map((value) => <li key={value}>{value}</li>)}</ul></div>
        ))}
        {(strategy.strategy.dossierResearchPlan?.length ?? 0) > 0 && <div className="strategy-blueprint">
          <span>Dossier research blueprint</span>
          <p>Every dossier worker uses this same focused format.</p>
          <ol>{strategy.strategy.dossierResearchPlan?.map((item) => <li key={item.section}><strong>{item.section}</strong><span>{item.purpose}</span><small>{item.evidenceNeeded.join(" · ")}</small></li>)}</ol>
        </div>}
        {(strategy.strategy.informationExclusions?.length ?? 0) > 0 && <div className="strategy-field"><span>Do not collect</span><ul>{strategy.strategy.informationExclusions?.map((value) => <li key={value}>{value}</li>)}</ul></div>}
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
        <div className="queue-control-main queue-cap-control">
          <div><span>Queue maximum</span><strong>{workspace.settings.queueBufferTarget}</strong><small>{workspace.settings.queueBufferAutomatic ? `Auto · 3 × ${workspace.settings.dossierWorkerLimit} workers` : "Manual override"}</small></div>
          <button aria-label="Decrease queue maximum" disabled={busy === "settings" || workspace.settings.queueBufferTarget <= 1} onClick={() => void settings({ queueBufferTarget: workspace.settings.queueBufferTarget - 1 })}>−</button>
          <button aria-label="Increase queue maximum" disabled={busy === "settings" || workspace.settings.queueBufferTarget >= 100} onClick={() => void settings({ queueBufferTarget: workspace.settings.queueBufferTarget + 1 })}>+</button>
        </div>
        <HelpLink article="research-queue" title="How the queue works" />
        <button className="secondary" disabled={busy === "settings" || workspace.settings.queueBufferAutomatic} onClick={() => void settings({ queueBufferAutomatic: true })}>
          <RefreshCw size={14} /> Auto 3×
        </button>
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
        {visible.length === 0 ? <div className="empty-inline">No companies are in the research queue yet. <HelpLink article="nothing-is-happening" label="Why nothing is being discovered" /></div> : (
          <table className="data-table research-queue-table">
            <thead><tr><th>Company</th><th>Qualification</th><th>Priority</th><th>Research</th><th>Decision</th><th /></tr></thead>
            <tbody>{visible.map((item) => {
              const name = companyName(item.data);
              const snapshot = workspace.contextSnapshots?.find((context) => context.candidateId === item.id);
              const strategy = workspace.strategies.find((version) => version.id === (snapshot?.strategyVersionId ?? item.strategyVersionId));
              return (
                <tr key={item.id}>
                  <td><strong>{name}</strong><span>{companyDetail(item.data)}</span></td>
                  <td>{item.qualificationScore ?? "—"}</td>
                  <td><div className="priority-control"><button onClick={() => void candidate(item.id, { priority: item.priority - 1 })}><ArrowDown size={13} /></button><strong>{item.priority}</strong><button onClick={() => void candidate(item.id, { priority: item.priority + 1 })}><ArrowUp size={13} /></button></div></td>
                  <td><span className={`pill ${item.dossierStatus === "completed" ? "good" : item.dossierStatus === "failed" ? "crit" : ""}`}>{item.queueStatus === "held" ? "held" : item.dossierStatus}</span>{snapshot && <small title={snapshot.contentHash}>Context locked · strategy {strategy ? `v${strategy.version}` : "snapshot"}</small>}{item.dossierReason && <small>{item.dossierReason}</small>}</td>
                  <td><select value={item.disposition} onChange={(event) => void candidate(item.id, { disposition: event.target.value })}><option value="unreviewed">Unreviewed</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="needs_revision">Needs revision</option></select></td>
                  <td><div className="row-actions"><button className="quiet" onClick={() => void candidate(item.id, { held: item.queueStatus !== "held" })}>{item.queueStatus === "held" ? <Play size={13} /> : <Pause size={13} />}{item.queueStatus === "held" ? "Resume" : "Hold"}</button>{item.linkedDocumentId && <button className="quiet" onClick={() => onOpenDocument(item.linkedDocumentId as string)}><FileText size={13} /> Open</button>}</div></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </section>
      <section className="research-queue-mobile" aria-label="Research queue mobile view">
        {visible.length === 0 ? <div className="surface empty-inline">No companies are in the research queue yet. <HelpLink article="nothing-is-happening" label="Why nothing is being discovered" /></div> : visible.map((item) => {
          const name = companyName(item.data);
          const snapshot = workspace.contextSnapshots?.find((context) => context.candidateId === item.id);
          return <article className="surface research-queue-card" key={item.id}>
            <header><div><strong>{name}</strong><span>{companyDetail(item.data) || "Company details pending"}</span></div><span className={`pill ${item.dossierStatus === "completed" ? "good" : item.dossierStatus === "failed" ? "crit" : ""}`}>{item.queueStatus === "held" ? "held" : item.dossierStatus}</span></header>
            <div className="queue-card-facts"><div><span>Qualification</span><strong>{item.qualificationScore ?? "—"}</strong></div><div><span>Priority</span><div className="priority-control"><button aria-label={`Decrease priority for ${name}`} onClick={() => void candidate(item.id, { priority: item.priority - 1 })}><ArrowDown size={15} /></button><strong>{item.priority}</strong><button aria-label={`Increase priority for ${name}`} onClick={() => void candidate(item.id, { priority: item.priority + 1 })}><ArrowUp size={15} /></button></div></div></div>
            {snapshot && <small>Context locked for this dossier</small>}
            {item.dossierReason && <p>{item.dossierReason}</p>}
            <label><span>Decision</span><select value={item.disposition} onChange={(event) => void candidate(item.id, { disposition: event.target.value })}><option value="unreviewed">Unreviewed</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="needs_revision">Needs revision</option></select></label>
            <footer><button className="secondary" onClick={() => void candidate(item.id, { held: item.queueStatus !== "held" })}>{item.queueStatus === "held" ? <Play size={14} /> : <Pause size={14} />}{item.queueStatus === "held" ? "Resume" : "Hold"}</button>{item.linkedDocumentId && <button className="primary" onClick={() => onOpenDocument(item.linkedDocumentId as string)}><FileText size={14} /> Open dossier</button>}</footer>
          </article>;
        })}
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
  // The review table needs roughly 820px to keep its decision actions on
  // screen, so narrow viewports open on cards instead. An explicit choice
  // still wins, and it survives rotation.
  const [chosenView, setChosenView] = useState<"list" | "cards" | null>(null);
  const compact = useCompactViewport();
  const view = chosenView ?? (compact ? "cards" : "list");
  const setView = setChosenView;
  const visibleDocuments = workspace.documents.filter((item) => {
    if (bin === "all") return true;
    return workspace.candidates.find((candidate) => candidate.linkedDocumentId === item.id)?.disposition === bin;
  });
  const document = visibleDocuments.find((item) => item.id === selected) ?? visibleDocuments[0];
  const requests = workspace.revisionRequests.filter((item) => item.documentId === document?.id);

  async function decide(documentId: string, disposition: "approved" | "declined" | "needs_revision") {
    const candidate = workspace.candidates.find((item) => item.linkedDocumentId === documentId);
    if (!candidate) return;
    setBusy(`decision:${documentId}`);
    try {
      await json(`/api/v1/projects/${projectId}/research-candidates/${candidate.id}`, {
        method: "PATCH", body: JSON.stringify({ disposition })
      });
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Could not save the dossier decision."); }
    finally { setBusy(null); }
  }

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

  if (workspace.documents.length === 0) return <div className="empty-module"><FileText size={24} /><h2>No dossiers yet</h2><p>Completed company research will appear here as editable master documents.</p><HelpLink article="reviewing-dossiers" label="How this works" /></div>;
  return (
    <div className="dossier-review-workspace">
      <section className="surface dossier-review-library">
        <div className="surface-header dossier-review-toolbar">
          <div><h2>Project knowledge <HelpLink article="reviewing-dossiers" title="How dossier review works" /></h2><span>{workspace.documents.length} synchronized company dossiers</span></div>
          <div className="surface-actions">
            <select aria-label="Dossier review bin" value={bin} onChange={(event) => setBin(event.target.value as typeof bin)}><option value="all">All dossiers</option><option value="unreviewed">To review</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="needs_revision">Returned</option></select>
            <div className="segmented-control" role="group" aria-label="Dossier view">
              <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><LayoutList size={14} /> List</button>
              <button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}><GalleryHorizontal size={14} /> Cards</button>
            </div>
          </div>
        </div>
        {visibleDocuments.length === 0 ? <div className="empty-inline">No dossiers in this review bin.</div> : view === "list" ? (
          <div className="dossier-review-table-wrap"><table className="data-table dossier-review-table">
            <thead><tr><th>Document</th><th>Decision summary</th><th>Status</th><th>Updated</th><th /></tr></thead>
            <tbody>{visibleDocuments.map((item) => {
              const candidate = workspace.candidates.find((entry) => entry.linkedDocumentId === item.id);
              return <tr key={item.id} className={item.id === document?.id ? "selected" : ""} aria-selected={item.id === document?.id} onClick={() => setSelected(item.id)}>
                <td><button className="link-button dossier-open" onClick={(event) => { event.stopPropagation(); onOpenDocument(item.id); }}>{item.title}</button><span>{item.wordCount.toLocaleString()} words</span></td>
                <td><p>{dossierSummary(item.summary)}</p></td>
                <td><span className={`pill ${candidate?.disposition === "approved" ? "good" : candidate?.disposition === "declined" ? "crit" : candidate?.disposition === "needs_revision" ? "warn" : ""}`}>{candidate?.disposition === "needs_revision" ? "returned" : candidate?.disposition ?? "unreviewed"}</span></td>
                <td>{new Date(item.updatedAt).toLocaleDateString()}</td>
                <td><DossierDecisionActions disabled={busy === `decision:${item.id}`} onDecision={(value) => void decide(item.id, value)} /></td>
              </tr>;
            })}</tbody>
          </table></div>
        ) : (
          <div className="dossier-paper-carousel">{visibleDocuments.map((item) => {
            const candidate = workspace.candidates.find((entry) => entry.linkedDocumentId === item.id);
            return <article className={`dossier-paper ${item.id === document?.id ? "selected" : ""}`} key={item.id} tabIndex={0} role="button" aria-pressed={item.id === document?.id} onClick={() => setSelected(item.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(item.id); } }}>
              <div className="dossier-paper-page"><span className="eyebrow">Company dossier</span><h3>{item.title}</h3><div className="paper-rule" /><p>{dossierSummary(item.summary)}</p><dl><div><dt>Status</dt><dd>{candidate?.disposition === "needs_revision" ? "Returned" : candidate?.disposition ?? "Unreviewed"}</dd></div><div><dt>Length</dt><dd>{item.wordCount.toLocaleString()} words</dd></div><div><dt>Updated</dt><dd>{new Date(item.updatedAt).toLocaleDateString()}</dd></div></dl></div>
              <footer><button className="link-button dossier-open" onClick={(event) => { event.stopPropagation(); onOpenDocument(item.id); }}><FileText size={13} /> Open full document</button><DossierDecisionActions disabled={busy === `decision:${item.id}`} onDecision={(value) => void decide(item.id, value)} /></footer>
            </article>;
          })}</div>
        )}
      </section>
      {document && <section className="dossier-review-lower">
        <div className="surface dossier-selected-summary"><div className="dossier-preview-head"><div><span className="eyebrow">Selected master file</span><h2>{document.title}</h2><p>Selected from the list above. Open the title, the card link, or this button to edit the full document.</p></div><button className="primary" onClick={() => onOpenDocument(document.id)}><FileText size={14} /> Open and edit</button></div><div className="dossier-preview-excerpt">{dossierSummary(document.summary, 520)}</div></div>
        <aside className="surface dossier-feedback"><div className="surface-header"><h2>Feedback & rework</h2><span>Separate queue</span></div><div className="dossier-feedback-body"><p>Ask a dossier agent to investigate missing information, answer questions, or rewrite sections. This does not use a primary dossier-worker slot.</p><textarea rows={5} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Add recent hiring activity and investigate the Busan expansion…" /><label><span>Questions (one per line)</span><textarea rows={3} value={questions} onChange={(event) => setQuestions(event.target.value)} placeholder="Who leads procurement?&#10;What changed in the last 90 days?" /></label>{workspace.projectDocuments.length > 1 && <fieldset className="dossier-attachments"><legend>Attach project documents</legend>{workspace.projectDocuments.filter((item) => item.id !== document.id).map((item) => <label key={item.id}><input type="checkbox" checked={attachmentIds.includes(item.id)} onChange={(event) => setAttachmentIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /> {item.title}</label>)}</fieldset>}<button className="primary" disabled={!feedback.trim() || busy === "rework"} onClick={() => void rework()}>{busy === "rework" ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />} Create proposed version</button>{requests.length > 0 && <div className="revision-request-list"><h3>Revision requests</h3>{requests.map((request) => <div key={request.id}><span className={`pill ${request.status === "completed" ? "good" : ""}`}>{request.status}</span><p>{request.instruction}</p></div>)}</div>}</div></aside>
      </section>}
    </div>
  );
}

function useCompactViewport(query = "(max-width: 760px)") {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setCompact(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);
  return compact;
}

function DossierDecisionActions({ disabled, onDecision }: {
  disabled: boolean;
  onDecision: (value: "approved" | "declined" | "needs_revision") => void;
}) {
  return <div className="dossier-decision-actions" onClick={(event) => event.stopPropagation()}>
    <button className="quiet approve" disabled={disabled} title="Approve dossier" aria-label="Approve dossier" onClick={() => onDecision("approved")}><Check size={14} /> Approve</button>
    <button className="quiet return" disabled={disabled} title="Return for revision" aria-label="Return dossier for revision" onClick={() => onDecision("needs_revision")}><RotateCcw size={14} /> Return</button>
    <button className="quiet decline" disabled={disabled} title="Decline company" aria-label="Decline company" onClick={() => onDecision("declined")}><X size={14} /> Deny</button>
  </div>;
}

function dossierSummary(summary: string, length = 260) {
  if (!summary.trim()) return "This dossier is ready to open. Its decision summary has not been generated yet.";
  return truncateDossierSummary(summary, length);
}

function companyName(data: Record<string, unknown>) {
  const keys = ["companyName", "legalName", "name", "Company", "Company Name"];
  for (const key of keys) if (typeof data[key] === "string" && data[key]) return String(data[key]);
  return String(Object.values(data).find((value) => typeof value === "string") ?? "Unnamed company");
}

function companyDetail(data: Record<string, unknown>) {
  return [data.location, data.industry, data.website].filter(Boolean).map(String).join(" · ");
}
