"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  Bot,
  ChevronRight,
  CircleAlert,
  Database,
  FileText,
  FolderKanban,
  Loader2,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  X
} from "lucide-react";
import type { Agenda, ExecutiveCommand, Project, Report } from "@/lib/domain";

type PageId = "agent" | "projects" | "documents" | "data" | "knowledge" | "settings";

const navItems: Array<{ id: PageId; label: string; icon: typeof Bot }> = [
  { id: "agent", label: "Executive Agent", icon: Bot },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "data", label: "Client & Data", icon: Database },
  { id: "knowledge", label: "Knowledge Base", icon: BookOpen },
  { id: "settings", label: "Settings", icon: Settings }
];

const pageCopy: Record<PageId, { title: string; subtitle: string; command: string; actions: string[] }> = {
  agent: {
    title: "Executive Agent",
    subtitle: "Portfolio, knowledge, client data, decisions, and instructions",
    command: "Give the Executive Agent an instruction across projects, data, knowledge, or decisions.",
    actions: ["Delegate work", "Review decisions", "Summarize portfolio"]
  },
  projects: {
    title: "Project Command Center",
    subtitle: "Long-lived context, agendas, execution, and outputs",
    command: "Add a project agenda, change scope, run the next batch, or request an output.",
    actions: ["Add agenda", "Run next batch", "Change scope", "Review plan"]
  },
  documents: {
    title: "Documents",
    subtitle: "Working project outputs and saved reports",
    command: "Draft, revise, save, export, or share a document.",
    actions: ["Draft report", "Save report", "Export"]
  },
  data: {
    title: "Client & Data",
    subtitle: "Configurable databases, records, imports, and enrichment",
    command: "Enrich records, validate sources, create a view, or link data to a project.",
    actions: ["Create database", "Import CSV", "Validate records"]
  },
  knowledge: {
    title: "Knowledge Base",
    subtitle: "Approved organizational memory with provenance",
    command: "Propose memory, review findings, or link a project decision.",
    actions: ["Propose memory", "Review updates", "Link decision"]
  },
  settings: {
    title: "Settings",
    subtitle: "Workspace governance, models, tools, and approval policy",
    command: "Adjust agent policy, model routing, tool access, or review gates.",
    actions: ["Adjust policy", "Review access", "Run audit"]
  }
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Request failed");
  }
  return response.json();
}

export function BusinessOS() {
  const [page, setPage] = useState<PageId>("agent");
  const [projects, setProjects] = useState<Project[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<(Project & { agendas: Agenda[] }) | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [pendingCommand, setPendingCommand] = useState<ExecutiveCommand | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);

  const loadProjects = useCallback(async () => {
    const payload = await api<{ data: Project[] }>("/api/v1/projects");
    setProjects(payload.data);
    if (!selectedProjectId && payload.data[0]) setSelectedProjectId(payload.data[0].id);
  }, [selectedProjectId]);

  const loadReports = useCallback(async () => {
    const payload = await api<{ data: Report[] }>("/api/v1/reports");
    setReports(payload.data);
  }, []);

  useEffect(() => {
    Promise.all([loadProjects(), loadReports()])
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [loadProjects, loadReports]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedProject(null);
      return;
    }
    api<{ data: Project & { agendas: Agenda[] } }>(`/api/v1/projects/${selectedProjectId}`)
      .then((payload) => setSelectedProject(payload.data))
      .catch((reason: Error) => setError(reason.message));
  }, [selectedProjectId, projects]);

  const counts = useMemo(() => ({
    active: projects.filter((project) => project.status === "active").length,
    archived: projects.filter((project) => project.status === "archived").length,
    workingReports: reports.filter((report) => report.status !== "saved").length,
    savedReports: reports.filter((report) => report.status === "saved").length
  }), [projects, reports]);

  async function submitCommand() {
    if (!command.trim()) return;
    setCommandBusy(true);
    setError(null);
    try {
      const payload = await api<{ data: ExecutiveCommand }>("/api/v1/commands", {
        method: "POST",
        body: JSON.stringify({
          page,
          projectId: page === "projects" ? selectedProjectId : null,
          instruction: command
        })
      });
      setPendingCommand(payload.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Command failed");
    } finally {
      setCommandBusy(false);
    }
  }

  async function confirmCommand() {
    if (!pendingCommand) return;
    setCommandBusy(true);
    try {
      await api(`/api/v1/commands/${pendingCommand.id}/confirm`, { method: "POST" });
      if (page === "projects" && selectedProjectId) {
        await api(`/api/v1/projects/${selectedProjectId}/agendas`, {
          method: "POST",
          body: JSON.stringify({ title: command.slice(0, 80), instruction: command })
        });
        const projectPayload = await api<{ data: Project & { agendas: Agenda[] } }>(
          `/api/v1/projects/${selectedProjectId}`
        );
        setSelectedProject(projectPayload.data);
      }
      setPendingCommand(null);
      setCommand("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Confirmation failed");
    } finally {
      setCommandBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">MTI</div>
          <div>
            <strong>MTI Korea</strong>
            <span>Business Operating System</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={page === item.id ? "nav-item active" : "nav-item"}
                key={item.id}
                onClick={() => setPage(item.id)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="workspace-identity">
          <span className="live-dot" />
          <div>
            <strong>MTI Korea</strong>
            <span>Single workspace</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{pageCopy[page].title}</h1>
            <p>{pageCopy[page].subtitle}</p>
          </div>
          <div className="topbar-actions">
            <button className="icon-text"><Search size={15} /> Search</button>
            <button className="primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> Create project</button>
          </div>
        </header>

        <section className="workspace">
          {error && <div className="error-banner"><CircleAlert size={15} />{error}<button onClick={() => setError(null)}><X size={14} /></button></div>}
          {loading ? <LoadingState /> : (
            <>
              {page === "agent" && <AgentView counts={counts} hasProjects={projects.length > 0} onCreate={() => setCreateOpen(true)} />}
              {page === "projects" && (
                <ProjectsView
                  projects={projects}
                  project={selectedProject}
                  selectedId={selectedProjectId}
                  onSelect={setSelectedProjectId}
                  onCreate={() => setCreateOpen(true)}
                />
              )}
              {page === "documents" && <DocumentsView reports={reports} />}
              {page === "data" && <EmptyModule icon={Database} title="No client databases" text="Create a database or import a CSV to begin organizing client and operational records." action="Create database" />}
              {page === "knowledge" && <EmptyModule icon={BookOpen} title="No approved memory" text="Proposed findings will appear here after they pass a review gate." action="Propose memory" />}
              {page === "settings" && <SettingsView />}
            </>
          )}
        </section>
      </main>

      <ExecutiveCommand
        page={page}
        value={command}
        pending={pendingCommand}
        busy={commandBusy}
        disabled={page === "projects" && !selectedProjectId}
        onChange={setCommand}
        onSubmit={submitCommand}
        onConfirm={confirmCommand}
        onAdjust={() => setPendingCommand(null)}
      />

      {createOpen && (
        <CreateProjectDialog
          onClose={() => setCreateOpen(false)}
          onCreated={async (project) => {
            setCreateOpen(false);
            await loadProjects();
            setSelectedProjectId(project.id);
            setPage("projects");
          }}
        />
      )}
    </div>
  );
}

function LoadingState() {
  return <div className="loading-state"><Loader2 size={20} className="spin" /><span>Loading workspace</span></div>;
}

function AgentView({ counts, hasProjects, onCreate }: {
  counts: { active: number; archived: number; workingReports: number; savedReports: number };
  hasProjects: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="agent-view">
      <div className="metrics">
        <Metric label="Active projects" value={counts.active} />
        <Metric label="Archived projects" value={counts.archived} />
        <Metric label="Working outputs" value={counts.workingReports} />
        <Metric label="Saved reports" value={counts.savedReports} />
      </div>
      {!hasProjects ? (
        <EmptyModule
          icon={Sparkles}
          title="Start with a project"
          text="Projects give the Executive Agent durable context, constraints, agendas, and review gates."
          action="Create project"
          onAction={onCreate}
        />
      ) : (
        <div className="surface-grid">
          <section className="surface">
            <div className="surface-header"><h2>Portfolio attention</h2></div>
            <div className="empty-inline">No blockers or decisions require attention.</div>
          </section>
          <section className="surface">
            <div className="surface-header"><h2>Agent allocation</h2></div>
            <div className="empty-inline">No worker runs are active.</div>
          </section>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function ProjectsView({ projects, project, selectedId, onSelect, onCreate }: {
  projects: Project[];
  project: (Project & { agendas: Agenda[] }) | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  if (projects.length === 0) {
    return <EmptyModule icon={FolderKanban} title="No projects" text="Create a project to establish context, constraints, agendas, and output requirements." action="Create project" onAction={onCreate} />;
  }
  return (
    <div className="project-layout">
      <aside className="project-list">
        <div className="list-heading"><span>Projects</span><button onClick={onCreate}><Plus size={14} /></button></div>
        {projects.map((item) => (
          <button key={item.id} className={selectedId === item.id ? "project-row selected" : "project-row"} onClick={() => onSelect(item.id)}>
            <strong>{item.name}</strong>
            <span>{item.status}</span>
          </button>
        ))}
      </aside>
      {project && (
        <div className="project-center">
          <section className="project-title">
            <div><span className="eyebrow">Project command center</span><h2>{project.name}</h2><p>{project.objective}</p></div>
            <span className="status">{project.status}</span>
          </section>
          <div className="project-context">
            <ContextBlock label="Context" value={project.context} />
            <ContextBlock label="Scope" value={project.scope} />
            <ContextBlock label="Constraints" value={project.constraints.join("\n")} />
            <ContextBlock label="Budget" value={project.budgetCents === null ? "" : formatMoney(project.budgetCents)} />
          </div>
          <div className="project-columns">
            <section className="surface agenda-surface">
              <div className="surface-header"><h2>Agenda lifecycle</h2><span>{project.agendas.length}</span></div>
              {project.agendas.length === 0 ? (
                <div className="empty-inline">No agendas yet. Use Executive Command to add the first instruction.</div>
              ) : (
                <div className="agenda-list">
                  {project.agendas.map((agenda) => (
                    <div className="agenda-row" key={agenda.id}>
                      <span className={`agenda-dot ${agenda.status}`} />
                      <div><strong>{agenda.title}</strong><p>{agenda.instruction}</p></div>
                      <span>{agenda.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="surface">
              <div className="surface-header"><h2>Execution now</h2></div>
              <div className="empty-inline">No runs are active.</div>
            </section>
          </div>
          <section className="surface">
            <div className="surface-header"><h2>Report outputs</h2></div>
            <div className="empty-inline">Outputs produced by this project will appear here as editable reports.</div>
          </section>
        </div>
      )}
    </div>
  );
}

function ContextBlock({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><p>{value || "Not set"}</p></div>;
}

function DocumentsView({ reports }: { reports: Report[] }) {
  const working = reports.filter((report) => report.status !== "saved");
  const saved = reports.filter((report) => report.status === "saved");
  return (
    <div className="documents-layout">
      <aside className="document-folders">
        <button className="active"><FolderKanban size={15} />Project folders<span>{working.length}</span></button>
        <button><Archive size={15} />Saved reports<span>{saved.length}</span></button>
      </aside>
      <section className="surface">
        <div className="surface-header"><h2>Project folders</h2></div>
        {working.length === 0 ? <div className="empty-inline">No working reports.</div> : working.map((report) => <ReportRow key={report.id} report={report} />)}
      </section>
    </div>
  );
}

function ReportRow({ report }: { report: Report }) {
  return <div className="report-row"><FileText size={18} /><div><strong>{report.title}</strong><span>{report.summary}</span></div><span>{report.status}</span><ChevronRight size={15} /></div>;
}

function SettingsView() {
  return (
    <div className="settings-grid">
      <section className="surface"><div className="surface-header"><h2>Workspace</h2></div><Setting label="Organization" value="MTI Korea" /><Setting label="Operator mode" value="Single workspace · no login" /></section>
      <section className="surface"><div className="surface-header"><h2>Infrastructure</h2></div><Setting label="Application" value="Railway" /><Setting label="Workflows" value="Trigger.dev managed" /><Setting label="Model gateway" value="LiteLLM" /></section>
      <section className="surface"><div className="surface-header"><h2>Review policy</h2></div><Setting label="External sends" value="Approval required" /><Setting label="Destructive writes" value="Approval required" /><Setting label="High-cost actions" value="Approval required" /></section>
    </div>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return <div className="setting"><span>{label}</span><strong>{value}</strong></div>;
}

function EmptyModule({ icon: Icon, title, text, action, onAction }: {
  icon: typeof Bot;
  title: string;
  text: string;
  action: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-module">
      <div className="empty-icon"><Icon size={22} /></div>
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="primary" onClick={onAction}><Plus size={14} />{action}</button>
    </div>
  );
}

function ExecutiveCommand({ page, value, pending, busy, disabled, onChange, onSubmit, onConfirm, onAdjust }: {
  page: PageId;
  value: string;
  pending: ExecutiveCommand | null;
  busy: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onConfirm: () => void;
  onAdjust: () => void;
}) {
  const config = pageCopy[page];
  return (
    <div className="command-wrap">
      {pending && (
        <div className="clarification">
          <div><Sparkles size={15} /><strong>Clarify before execution</strong></div>
          <p>{pending.clarification}</p>
          <div className="clarification-actions">
            <button className="primary" onClick={onConfirm} disabled={busy}>Confirm</button>
            <button className="secondary" onClick={onAdjust}>Adjust instruction</button>
          </div>
        </div>
      )}
      <div className="command">
        <div className="command-head"><span className="live-dot" /><strong>Executive Command</strong><span>{config.title}</span></div>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={disabled ? "Select a project before adding an instruction." : config.command}
          rows={value.split("\n").length > 2 ? 5 : 2}
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onSubmit();
          }}
        />
        <div className="command-actions">
          <button className="icon-only" title="Attach context"><Paperclip size={15} /></button>
          {config.actions.map((action) => <button key={action} className="command-chip" onClick={() => onChange(action)}>{action}</button>)}
          <div className="spacer" />
          <button className="send" onClick={onSubmit} disabled={disabled || busy || !value.trim()}>
            {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (project: Project) => void }) {
  const [form, setForm] = useState({ name: "", objective: "", context: "", scope: "", constraints: "", budget: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = await api<{ data: Project }>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          objective: form.objective,
          context: form.context,
          scope: form.scope,
          constraints: form.constraints.split("\n").map((item) => item.trim()).filter(Boolean),
          budgetCents: form.budget ? Math.round(Number(form.budget) * 100) : null
        })
      });
      onCreated(payload.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="dialog" onSubmit={submit}>
        <div className="dialog-head"><div><span className="eyebrow">New project</span><h2>Create durable project context</h2></div><button type="button" className="icon-only" onClick={onClose}><X size={17} /></button></div>
        {error && <div className="field-error">{error}</div>}
        <div className="form-grid">
          <label>Project name<input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Budget (USD)<input type="number" min="0" value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value })} /></label>
          <label className="span-2">Objective<textarea required minLength={10} rows={3} value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} /></label>
          <label>Context<textarea rows={4} value={form.context} onChange={(event) => setForm({ ...form, context: event.target.value })} /></label>
          <label>Scope<textarea rows={4} value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })} /></label>
          <label className="span-2">Constraints <span>One per line</span><textarea rows={4} value={form.constraints} onChange={(event) => setForm({ ...form, constraints: event.target.value })} /></label>
        </div>
        <div className="dialog-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy && <Loader2 size={14} className="spin" />}Create project</button></div>
      </form>
    </div>
  );
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}
