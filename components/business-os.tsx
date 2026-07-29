"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Bot,
  CircleAlert,
  Database,
  FileText,
  FolderKanban,
  Loader2,
  Mail,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  X
} from "lucide-react";
import type {
  Agenda,
  AgendaWorkType,
  Deliverable,
  ExecutiveCommand,
  Milestone,
  Project,
  ProjectRecord,
  Report,
  WorkspaceDocument
} from "@/lib/domain";
import { ClientDataView } from "@/components/client-data-view";
import { ClientChangeReview } from "@/components/client-change-review";
import { DocumentsView } from "@/components/documents-view";
import { KnowledgeView } from "@/components/knowledge-view";
import { LiveActivity } from "@/components/live-activity";
import { SearchPalette } from "@/components/search-palette";
import { Modal } from "@/components/ui/modal";
import { useI18n, type RegionalPreferences } from "@/lib/i18n";

type PageId = "agent" | "projects" | "documents" | "data" | "knowledge" | "settings";
type ProjectDetail = Project & {
  agendas: Agenda[];
  milestones: Milestone[];
  records: ProjectRecord[];
  deliverables: Deliverable[];
};

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
  const { t } = useI18n();
  const [page, setPage] = useState<PageId>("agent");
  const [projects, setProjects] = useState<Project[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Array<{ id: number; message: string }>>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusDocumentId, setFocusDocumentId] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [pendingCommand, setPendingCommand] = useState<ExecutiveCommand | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [agendaWorkType, setAgendaWorkType] = useState<AgendaWorkType>("custom");

  /** Errors accumulate so a failed batch reports every failure, not just the last. */
  const pushError = useCallback((message: string) => {
    const localized = t(message);
    setErrors((current) =>
      current.some((entry) => entry.message === localized)
        ? current
        : [...current, { id: Date.now() + Math.random(), message: localized }].slice(-4)
    );
  }, [t]);
  const dismissError = useCallback((id: number) => {
    setErrors((current) => current.filter((entry) => entry.id !== id));
  }, []);

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
      .catch((reason: Error) => pushError(reason.message))
      .finally(() => setLoading(false));
  }, [loadProjects, loadReports, pushError]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedProject(null);
      return;
    }
    api<{ data: ProjectDetail }>(`/api/v1/projects/${selectedProjectId}`)
      .then((payload) => setSelectedProject(payload.data))
      .catch((reason: Error) => pushError(reason.message));
  }, [selectedProjectId, projects, pushError]);

  useEffect(() => {
    const storedDraft = window.localStorage.getItem(`executive-command:draft:${page}`);
    setCommand(storedDraft ?? "");
    const pendingId = window.localStorage.getItem("executive-command:pending");
    if (pendingId) {
      api<{ data: ExecutiveCommand }>(`/api/v1/commands/${pendingId}`)
        .then((payload) => setPendingCommand(payload.data))
        .catch(() => window.localStorage.removeItem("executive-command:pending"));
    }
  }, [page]);

  useEffect(() => {
    window.localStorage.setItem(`executive-command:draft:${page}`, command);
  }, [command, page]);

  const counts = useMemo(() => ({
    active: projects.filter((project) => project.status === "active").length,
    archived: projects.filter((project) => project.status === "archived").length,
    workingReports: reports.filter((report) => report.status !== "saved").length,
    savedReports: reports.filter((report) => report.status === "saved").length
  }), [projects, reports]);

  const navCounts: Partial<Record<PageId, number>> = {
    projects: projects.filter((project) => project.status === "active").length,
    documents: reports.filter((report) => report.status !== "saved").length
  };

  // ⌘K / Ctrl+K opens search from anywhere, as the top bar advertises.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function submitCommand() {
    if (!command.trim()) return;
    setCommandBusy(true);
    try {
      const payload = await api<{ data: ExecutiveCommand }>("/api/v1/commands", {
        method: "POST",
        body: JSON.stringify({
          page,
          projectId: page === "projects" ? selectedProjectId : null,
          instruction: command,
          context: {
            page,
            projectId: page === "projects" ? selectedProjectId : null,
            documentId: page === "documents" ? focusDocumentId : null
          }
        })
      });
      setPendingCommand(payload.data);
      window.localStorage.setItem("executive-command:pending", payload.data.id);
    } catch (reason) {
      pushError(reason instanceof Error ? reason.message : "Command failed");
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
          body: JSON.stringify({
            title: agendaTitle(command),
            instruction: command,
            workType: agendaWorkType
          })
        });
        const projectPayload = await api<{ data: ProjectDetail }>(
          `/api/v1/projects/${selectedProjectId}`
        );
        setSelectedProject(projectPayload.data);
      }
      setPendingCommand(null);
      setCommand("");
      window.localStorage.removeItem("executive-command:pending");
      window.localStorage.removeItem(`executive-command:draft:${page}`);
    } catch (reason) {
      pushError(reason instanceof Error ? reason.message : "Confirmation failed");
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
            <span>{t("Business Operating System")}</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            const count = navCounts[item.id];
            return (
              <button
                className={page === item.id ? "nav-item active" : "nav-item"}
                key={item.id}
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => setPage(item.id)}
              >
                <Icon size={16} aria-hidden />
                <span>{t(item.label)}</span>
                {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
              </button>
            );
          })}
        </nav>
        <div className="workspace-identity">
          <span className="live-dot" />
          <div>
            <strong>MTI Korea</strong>
            <span>{t("Single workspace")}</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{t(pageCopy[page].title)}</h1>
            <p>{t(pageCopy[page].subtitle)}</p>
          </div>
          <div className="topbar-actions">
            <button className="search-trigger" onClick={() => setSearchOpen(true)}>
              <Search size={15} aria-hidden /> {t("Search")}
              <kbd>⌘K</kbd>
            </button>
            <button className="primary" onClick={() => setCreateOpen(true)}><Plus size={15} aria-hidden /> {t("Create project")}</button>
          </div>
        </header>

        <section className="workspace">
          {errors.length > 0 && (
            <div className="error-stack">
              {errors.map((entry) => (
                <div className="error-banner" role="alert" key={entry.id}>
                  <CircleAlert size={15} aria-hidden />
                  {entry.message}
                  <button onClick={() => dismissError(entry.id)} aria-label={t("Dismiss error")}><X size={14} aria-hidden /></button>
                </div>
              ))}
            </div>
          )}
          {loading ? <LoadingState /> : (
            <>
              {page === "agent" && (
                <AgentView
                  counts={counts}
                  hasProjects={projects.length > 0}
                  onCreate={() => setCreateOpen(true)}
                />
              )}
              {page === "projects" && (
                <ProjectsView
                  projects={projects}
                  project={selectedProject}
                  selectedId={selectedProjectId}
                  onSelect={setSelectedProjectId}
                  onCreate={() => setCreateOpen(true)}
                  onError={pushError}
                  onOpenDocument={(documentId) => {
                    setFocusDocumentId(documentId);
                    setPage("documents");
                  }}
                />
              )}
              {page === "documents" && (
                <DocumentsView
                  onError={pushError}
                  projects={projects}
                  focusDocumentId={focusDocumentId}
                  onFocusHandled={() => setFocusDocumentId(null)}
                />
              )}
              {page === "data" && <ClientDataView onError={pushError} />}
              {page === "knowledge" && <KnowledgeView onError={pushError} />}
              {page === "settings" && <SettingsView onError={pushError} />}
            </>
          )}
        </section>

        <ExecutiveCommand
          page={page}
          value={command}
          pending={pendingCommand}
          busy={commandBusy}
          disabled={page === "projects" && !selectedProjectId}
          onChange={setCommand}
          onSubmit={submitCommand}
          onConfirm={confirmCommand}
          workType={agendaWorkType}
          onWorkTypeChange={setAgendaWorkType}
          onAdjust={() => {
            setPendingCommand(null);
            window.localStorage.removeItem("executive-command:pending");
          }}
        />
      </main>

      {searchOpen && (
        <SearchPalette
          onClose={() => setSearchOpen(false)}
          onSelect={(hit) => {
            setSearchOpen(false);
            if (hit.kind === "document" && hit.documentId) {
              setFocusDocumentId(hit.documentId);
              setPage("documents");
            } else if (hit.kind === "knowledge") {
              setPage("knowledge");
            } else if (hit.kind === "database") {
              setPage("data");
            } else if (hit.projectId) {
              setSelectedProjectId(hit.projectId);
              setPage("projects");
            }
          }}
        />
      )}

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
  const { t } = useI18n();
  return <div className="loading-state"><Loader2 size={20} className="spin" /><span>{t("Loading workspace")}</span></div>;
}

function AgentView({ counts, hasProjects, onCreate }: {
  counts: { active: number; archived: number; workingReports: number; savedReports: number };
  hasProjects: boolean;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="agent-view">
      <div className="metrics">
        <Metric label={t("Active projects")} value={counts.active} note={t("In flight")} />
        <Metric label={t("Working outputs")} value={counts.workingReports} note={t("Drafts in progress")} attention />
        <Metric label={t("Saved reports")} value={counts.savedReports} note={t("Released")} />
        <Metric label={t("Archived projects")} value={counts.archived} note={t("Closed")} />
      </div>
      {!hasProjects ? (
        <EmptyModule
          icon={Sparkles}
          title={t("Start with a project")}
          text={t("Projects give the Executive Agent durable context, constraints, agendas, and review gates.")}
          action={t("Create project")}
          onAction={onCreate}
        />
      ) : (
        <div className="surface-grid">
          <section className="surface">
            <div className="surface-header"><h2>{t("Portfolio attention")}</h2></div>
            <div className="empty-inline">{t("No blockers or decisions require attention.")}</div>
          </section>
          <section className="surface">
            <div className="surface-header"><h2>{t("Agent allocation")}</h2></div>
            <div className="empty-inline">{t("No worker runs are active.")}</div>
          </section>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, note, attention = false }: {
  label: string;
  value: number;
  note?: string;
  attention?: boolean;
}) {
  const { formatNumber, t } = useI18n();
  return (
    <div className={attention && value > 0 ? "metric attention" : "metric"}>
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
      {note && (
        <span className="metric-note">
          {attention && value > 0 && <span className="pill warn">{t("needs you")}</span>}
          {note}
        </span>
      )}
    </div>
  );
}

function ProjectsView({ projects, project, selectedId, onSelect, onCreate, onError, onOpenDocument }: {
  projects: Project[];
  project: ProjectDetail | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onError: (message: string) => void;
  onOpenDocument: (documentId: string) => void;
}) {
  const { formatCurrency, formatNumber, t } = useI18n();
  if (projects.length === 0) {
    return <EmptyModule icon={FolderKanban} title={t("No projects")} text={t("Create a project to establish context, constraints, agendas, and output requirements.")} action={t("Create project")} onAction={onCreate} />;
  }
  return (
    <div className="project-layout">
      <aside className="project-list">
        <div className="list-heading"><span>{t("Projects")}</span><button onClick={onCreate}><Plus size={14} /></button></div>
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
            <div><span className="eyebrow">{t("Project command center")}</span><h2>{project.name}</h2><p>{project.objective}</p></div>
            <span className={`pill ${project.status === "active" ? "good" : project.status === "archived" ? "" : "warn"}`}>
              {project.status}
            </span>
          </section>
          <div className="project-context">
            <ContextBlock label={t("Context")} value={project.context} />
            <ContextBlock label={t("Scope")} value={project.scope} />
            <div>
              <span>{t("Constraints")}</span>
              {project.constraints.length === 0 ? (
                <p>{t("Not set")}</p>
              ) : (
                <ul className="constraint-list">
                  {project.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}
                </ul>
              )}
            </div>
            <div>
              <span>{t("Budget")}</span>
              {project.budgetCents === null
                ? <p>{t("Not set")}</p>
                : <span className="budget-figure">{formatCurrency(project.budgetCents, project.budgetCurrency)}</span>}
            </div>
            <div>
              <span>{t("Review gates")}</span>
              <p>{project.reviewGates.length > 0 ? project.reviewGates.join(" · ") : t("Not set")}</p>
            </div>
            <div>
              <span>{t("Output requirements")}</span>
              <p>{project.outputRequirements.length > 0 ? project.outputRequirements.join(" · ") : t("Not set")}</p>
            </div>
          </div>
          <div className="project-columns">
            <section className="surface agenda-surface">
              <div className="surface-header"><h2>{t("Agenda lifecycle")}</h2><span>{formatNumber(project.agendas.length)}</span></div>
              {project.agendas.length === 0 ? (
                <div className="empty-inline">{t("No agendas yet. Use Executive Command to add the first instruction.")}</div>
              ) : (
                <div className="agenda-list">
                  {project.agendas.map((agenda) => (
                    <AgendaRow key={agenda.id} agenda={agenda} />
                  ))}
                </div>
              )}
            </section>
            <LiveActivity projectId={project.id} />
          </div>
          <div className="project-columns">
            <ProjectRegister title={t("Milestones")} items={project.milestones.map((item) => item.title)} />
            <ProjectRegister
              title={t("Decisions, assumptions, and questions")}
              items={project.records.map((item) => `${item.kind}: ${item.content}`)}
            />
          </div>
          <ProjectRegister
            title={t("Deliverables")}
            items={project.deliverables.map((item) => `${item.title} · ${item.status}`)}
          />
          <ClientChangeReview projectId={project.id} onError={onError} />
          <ProjectFiles projectId={project.id} onOpenDocument={onOpenDocument} />
        </div>
      )}
    </div>
  );
}

/**
 * The title is derived from the instruction, so printing both is redundant.
 * The full instruction is available on expand instead.
 */
function AgendaRow({ agenda }: { agenda: Agenda }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const truncated = agenda.instruction.trim() !== agenda.title.trim();

  return (
    <button
      className="agenda-row"
      onClick={() => truncated && setExpanded((value) => !value)}
      aria-expanded={truncated ? expanded : undefined}
      style={{ cursor: truncated ? "pointer" : "default" }}
    >
      <span className={`agenda-dot ${agenda.status}`} />
      <div>
        <strong>{agenda.title}</strong>
        <span className="agenda-type">{t(agenda.workType.replace("_", " "))}</span>
        {expanded && <p className="agenda-instruction">{agenda.instruction}</p>}
      </div>
      <span className={`pill ${agenda.status === "completed" ? "good" : agenda.status === "blocked" ? "crit" : agenda.status === "review" ? "warn" : ""}`}>
        {t(agenda.status)}
      </span>
    </button>
  );
}

function ProjectRegister({ title, items }: { title: string; items: string[] }) {
  const { formatNumber, t } = useI18n();
  return (
    <section className="surface">
      <div className="surface-header"><h2>{title}</h2><span>{formatNumber(items.length)}</span></div>
      {items.length === 0
        ? <div className="empty-inline">{t("Nothing recorded yet.")}</div>
        : <ul className="constraint-list">{items.map((item) => <li key={item}>{item}</li>)}</ul>}
    </section>
  );
}

/** Documents attached to this project, so uploads are grounded in real work. */
function ProjectFiles({ projectId, onOpenDocument }: {
  projectId: string;
  onOpenDocument: (documentId: string) => void;
}) {
  const { formatNumber, t } = useI18n();
  const [files, setFiles] = useState<WorkspaceDocument[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/v1/documents")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("failed"))))
      .then((payload: { data: WorkspaceDocument[] }) => {
        if (live) setFiles(payload.data.filter((document) => document.projectId === projectId));
      })
      .catch(() => { if (live) setFiles([]); });
    return () => { live = false; };
  }, [projectId]);

  return (
    <section className="surface">
      <div className="surface-header">
        <h2>{t("Project files")}</h2>
        <span>{files === null ? "…" : t("{count} attached", { count: formatNumber(files.length) })}</span>
      </div>
      {files === null ? (
        <div className="empty-inline">{t("Loading files…")}</div>
      ) : files.length === 0 ? (
        <div className="empty-inline">
          {t("No files attached. Open a document and set its project to ground the agent in real BOMs and quotations.")}
        </div>
      ) : (
        <ul className="document-list">
          {files.map((file) => (
            <li key={file.id}>
              <div className="document-row" style={{ cursor: "default" }}>
                <button className="document-open" onClick={() => onOpenDocument(file.id)}>
                  <span className={`kind-badge ${file.sourceKind}`}>{file.sourceKind}</span>
                  <span className="document-meta">
                    <strong>{file.title}</strong>
                    <span>{file.filename} · {t("{count} words", { count: formatNumber(file.wordCount) })}</span>
                  </span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ContextBlock({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  return <div><span>{label}</span><p>{value || t("Not set")}</p></div>;
}

function SettingsView({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="settings-grid">
      <PreferenceSettings onError={onError} />
      <ModelSettings onError={onError} />
      <McpSettings onError={onError} />
      <section className="surface"><div className="surface-header"><h2>{t("Review policy")}</h2></div><Setting label={t("External sends")} value={t("Approval required")} /><Setting label={t("Destructive writes")} value={t("Approval required")} /><Setting label={t("High-cost actions")} value={t("Approval required")} /></section>
      <GmailSettings onError={onError} />
    </div>
  );
}

function PreferenceSettings({ onError }: { onError: (message: string) => void }) {
  const { preferences, setPreferences, t } = useI18n();
  const [value, setValue] = useState<RegionalPreferences>(preferences);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ data: RegionalPreferences }>("/api/v1/settings/preferences")
      .then((payload) => setValue(payload.data))
      .catch((error: Error) => onError(error.message));
  }, [onError]);
  useEffect(() => setValue(preferences), [preferences]);
  async function save() {
    if (!value) return;
    setBusy(true);
    try {
      const payload = await api<{ data: RegionalPreferences }>("/api/v1/settings/preferences", {
        method: "PATCH", body: JSON.stringify(value)
      });
      setValue(payload.data);
      setPreferences(payload.data);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Preferences could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface settings-wide">
      <div className="surface-header"><h2>{t("Language & regional")}</h2></div>
      <div className="settings-form">
        <label>{t("Interface language")}<select value={value.locale} onChange={(event) => setValue({ ...value, locale: event.target.value as RegionalPreferences["locale"] })}><option value="en">English</option><option value="ko">한국어</option></select></label>
        <label>{t("Timezone")}<input value={value.timezone} onChange={(event) => setValue({ ...value, timezone: event.target.value })} /></label>
        <label>{t("Date format")}<select value={value.dateFormat} onChange={(event) => setValue({ ...value, dateFormat: event.target.value as RegionalPreferences["dateFormat"] })}><option value="short">{t("Short")}</option><option value="medium">{t("Medium")}</option><option value="long">{t("Long")}</option></select></label>
        <label>{t("Currency")}<select value={value.currency} onChange={(event) => setValue({ ...value, currency: event.target.value as RegionalPreferences["currency"] })}><option value="USD">USD</option><option value="KRW">KRW</option></select></label>
        <button className="primary" onClick={() => void save()} disabled={busy}>{busy && <Loader2 size={14} className="spin" />}{t("Save preferences")}</button>
      </div>
    </section>
  );
}

type ModelSettingsPayload = {
  environment: string;
  testingMode: boolean;
  gateway: string;
  health: string;
  recentCalls: Array<{ route: string; provider: string | null; model: string | null; costMicros: number; latencyMs: number; error: string | null }>;
  revisions: Array<{ id: string; route: string; version: number; status: string; testStatus: string }>;
  routes: Array<{
    route: string; purpose: string; maxCostMicros: number; structuredOutput: boolean;
    candidates: Array<{ order: number; provider: "openrouter" | "nvidia"; model: string; modelEnv: string; pricingClass: "paid" | "free"; productionApproved: boolean; licensingStatus: "approved" | "testing_only" | "unverified"; enabled: boolean }>;
  }>;
};

function ModelSettings({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState<ModelSettingsPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { maxCostMicros: number; structuredOutput: boolean }>>({});
  const lastSuccessful = value?.recentCalls.find((call) => !call.error);
  const load = useCallback(() => api<ModelSettingsPayload>("/api/v1/settings/models").then((payload) => {
    setValue(payload);
    setDrafts((current) => Object.fromEntries(payload.routes.map((route) => [
      route.route,
      current[route.route] ?? {
        maxCostMicros: route.maxCostMicros,
        structuredOutput: route.structuredOutput
      }
    ])));
  }), []);
  useEffect(() => { load().catch((error: Error) => onError(error.message)); }, [load, onError]);
  async function stage(route: ModelSettingsPayload["routes"][number]) {
    setBusy(route.route);
    try {
      await api("/api/v1/settings/models/revisions", {
        method: "POST",
        body: JSON.stringify({
          route: route.route,
          maxCostMicros: drafts[route.route]?.maxCostMicros ?? route.maxCostMicros,
          structuredOutput: drafts[route.route]?.structuredOutput ?? route.structuredOutput,
          candidates: route.candidates.map(({ provider, modelEnv, pricingClass, productionApproved, licensingStatus }) => ({
            provider, modelEnv, pricingClass, productionApproved, licensingStatus
          }))
        })
      });
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Route revision could not be staged.");
    } finally {
      setBusy(null);
    }
  }
  async function transition(id: string, action: "test" | "approve" | "activate" | "rollback") {
    setBusy(id);
    try {
      await api(`/api/v1/settings/models/revisions/${id}`, {
        method: "POST", body: JSON.stringify({ action })
      });
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Route revision could not be updated.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="surface settings-wide">
      <div className="surface-header"><h2>{t("Model routing")}</h2><span>{value ? `${value.gateway} · ${value.environment} · ${value.testingMode ? t("testing mode") : t("production policy")} · ${t(value.health)}` : t("Loading…")}</span></div>
      {!value ? <div className="empty-inline">{t("Loading model routes…")}</div> : (
        <div className="settings-table" role="table">
          {value.routes.map((route) => (
            <div className="model-route-row" role="row" key={route.route}>
              <div><strong>{route.route}</strong><span>{t(route.purpose)} · {t("limit")} ${(route.maxCostMicros / 1_000_000).toFixed(2)}</span></div>
              <div>
                {route.candidates.map((candidate) => <span className={candidate.enabled ? "pill good" : "pill warn"} key={`${candidate.order}-${candidate.provider}`}>{candidate.order}. {candidate.provider} · {candidate.model} · {t(candidate.licensingStatus)}</span>)}
                <label className="model-route-control">
                  {t("Cost limit")}
                  <input
                    type="number"
                    min="0.001"
                    max="1"
                    step="0.001"
                    value={(drafts[route.route]?.maxCostMicros ?? route.maxCostMicros) / 1_000_000}
                    onChange={(event) => setDrafts((current) => ({
                      ...current,
                      [route.route]: {
                        maxCostMicros: Math.round(Number(event.target.value) * 1_000_000),
                        structuredOutput: current[route.route]?.structuredOutput ?? route.structuredOutput
                      }
                    }))}
                  />
                </label>
                <label className="model-route-check">
                  <input
                    type="checkbox"
                    checked={drafts[route.route]?.structuredOutput ?? route.structuredOutput}
                    onChange={(event) => setDrafts((current) => ({
                      ...current,
                      [route.route]: {
                        maxCostMicros: current[route.route]?.maxCostMicros ?? route.maxCostMicros,
                        structuredOutput: event.target.checked
                      }
                    }))}
                  />
                  {t("Structured output")}
                </label>
                <button className="secondary" disabled={busy !== null} onClick={() => void stage(route)}>{t("Stage revision")}</button>
              </div>
            </div>
          ))}
          {value.revisions.map((revision) => (
            <div className="model-route-row" key={revision.id}>
              <div><strong>{revision.route} v{revision.version}</strong><span>{t(revision.status)} · {t("test")} {t(revision.testStatus)}</span></div>
              <div>
                {revision.testStatus !== "passed" && <button className="secondary" disabled={busy !== null} onClick={() => void transition(revision.id, "test")}>{t("Test")}</button>}
                {revision.testStatus === "passed" && revision.status === "draft" && <button className="secondary" disabled={busy !== null} onClick={() => void transition(revision.id, "approve")}>{t("Approve")}</button>}
                {revision.status === "approved" && <button className="primary" disabled={busy !== null} onClick={() => void transition(revision.id, "activate")}>{t("Activate")}</button>}
                {revision.status === "active" && <button className="secondary" disabled={busy !== null} onClick={() => void transition(revision.id, "rollback")}>{t("Rollback")}</button>}
              </div>
            </div>
          ))}
          {lastSuccessful && (
            <div className="model-route-row">
              <div><strong>{t("Last successful model")}</strong><span>{lastSuccessful.route}</span></div>
              <div><span className="pill good">{lastSuccessful.provider ?? "unknown"} · {lastSuccessful.model ?? "unknown"} · {lastSuccessful.latencyMs} ms · ${(lastSuccessful.costMicros / 1_000_000).toFixed(4)}</span></div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function McpSettings({ onError }: { onError: (message: string) => void }) {
  const { formatDate, formatNumber, t } = useI18n();
  const [tools, setTools] = useState<Array<{ id: string; name: string; riskLevel: string; approvalRequirement: string; active: boolean }>>([]);
  const [servers, setServers] = useState<Array<{
    id: string; name: string; transport: string; status: string; healthStatus: string;
    lastHealthCheckAt: string | null;
  }>>([]);
  useEffect(() => {
    Promise.all([
      api<{ data: typeof tools }>("/api/v1/mcp/tools").then((payload) => setTools(payload.data)),
      api<{ mcp: { servers: typeof servers } }>("/api/v1/settings/integrations")
        .then((payload) => setServers(payload.mcp.servers))
    ])
      .catch((error: Error) => onError(error.message));
  }, [onError]);
  return (
    <section className="surface settings-wide">
      <div className="surface-header"><h2>{t("MCP tools")}</h2><span>{formatNumber(tools.length)} {t("allowed")}</span></div>
      {servers.map((server) => (
        <Setting
          key={server.id}
          label={`${server.name} · ${server.transport}`}
          value={`${t(server.status)} · ${t(server.healthStatus)}${server.lastHealthCheckAt ? ` · ${formatDate(server.lastHealthCheckAt)}` : ""}`}
        />
      ))}
      {tools.length === 0 ? <div className="empty-inline">{t("No MCP tools available.")}</div> : tools.map((tool) => (
        <Setting key={tool.id} label={tool.name} value={`${t(tool.riskLevel)} · ${t(tool.approvalRequirement)}`} />
      ))}
    </section>
  );
}

type GmailConnection = {
  id: string;
  email: string;
  status: string;
  scopes: string[];
  lastSyncAt: string | null;
};

function GmailSettings({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  const [connections, setConnections] = useState<GmailConnection[]>([]);
  const [oauthConfigured, setOauthConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/integrations/gmail");
    if (!response.ok) throw new Error("Could not load Gmail connections.");
    const payload = (await response.json()) as { data: GmailConnection[] };
    setConnections(payload.data);
  }, []);

  useEffect(() => {
    Promise.all([
      load(),
      api<{ gmail: { oauthConfigured: boolean } }>("/api/v1/settings/integrations")
        .then((payload) => setOauthConfigured(payload.gmail.oauthConfigured))
    ]).catch((reason: Error) => onError(reason.message));
  }, [load, onError]);

  async function connect() {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/integrations/gmail/authorize", { method: "POST" });
      const payload = (await response.json()) as { data?: { url: string }; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Gmail authorization could not start.");
      window.location.assign(payload.data.url);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Gmail authorization could not start.");
      setBusy(false);
    }
  }

  async function disconnect(connectionId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/integrations/gmail/${connectionId}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Gmail connection could not be removed.");
      await load();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Gmail connection could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface integration-settings">
      <div className="surface-header">
        <div>
          <h2>{t("Gmail")}</h2>
          <span>{t("Read selected threads and create drafts")} · {t(oauthConfigured ? "OAuth configured" : "OAuth not configured")}</span>
        </div>
        <button className="secondary" onClick={() => void connect()} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" aria-hidden /> : <Mail size={14} aria-hidden />}
          {t("Connect")}
        </button>
      </div>
      {connections.length === 0 ? (
        <div className="empty-inline">{t("No Gmail account connected.")}</div>
      ) : connections.map((connection) => (
        <div className="integration-row" key={connection.id}>
          <div>
            <strong>{connection.email}</strong>
            <span>{t(connection.status)} · {t("Gmail read and compose")}</span>
          </div>
          <button
            className="secondary"
            onClick={() => void disconnect(connection.id)}
            disabled={busy || connection.status === "revoked"}
          >
            {t("Disconnect")}
          </button>
        </div>
      ))}
      <p className="integration-policy">{t("Sending and mailbox deletion are unavailable.")}</p>
    </section>
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

function ExecutiveCommand({
  page, value, pending, busy, disabled, workType,
  onChange, onSubmit, onConfirm, onAdjust, onWorkTypeChange
}: {
  page: PageId;
  value: string;
  pending: ExecutiveCommand | null;
  busy: boolean;
  disabled: boolean;
  workType: AgendaWorkType;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onConfirm: () => void;
  onAdjust: () => void;
  onWorkTypeChange: (value: AgendaWorkType) => void;
}) {
  const { t } = useI18n();
  const config = pageCopy[page];
  return (
    <div className="command-wrap">
      {pending && (
        <div className="clarification">
          <div><Sparkles size={15} /><strong>{t("Clarify before execution")}</strong></div>
          <p>{pending.clarification}</p>
          <div className="clarification-actions">
            <button className="primary" onClick={onConfirm} disabled={busy}>{t("Confirm")}</button>
            <button className="secondary" onClick={onAdjust}>{t("Adjust instruction")}</button>
          </div>
        </div>
      )}
      <div className="command">
        <div className="command-head"><span className="live-dot" /><strong>{t("Executive Command")}</strong><span>{t(config.title)}</span></div>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={disabled ? t("Select a project before adding an instruction.") : t(config.command)}
          rows={value.split("\n").length > 2 ? 5 : 2}
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onSubmit();
          }}
        />
        <div className="command-actions">
          {page === "projects" && (
            <select
              className="command-select"
              aria-label={t("Agenda work type")}
              value={workType}
              onChange={(event) => onWorkTypeChange(event.target.value as AgendaWorkType)}
            >
              {AGENDA_TYPES.map((type) => (
                <option key={type} value={type}>{t(type.replace("_", " "))}</option>
              ))}
            </select>
          )}
          {config.actions.map((action) => <button key={action} className="command-chip" onClick={() => onChange(action)}>{t(action)}</button>)}
          <div className="spacer" />
          <button
            className="send"
            onClick={onSubmit}
            disabled={disabled || busy || !value.trim()}
            aria-label={busy ? t("Sending instruction") : t("Send instruction")}
            title={`${t("Send instruction")} (⌘↵)`}
          >
            {busy ? <Loader2 size={15} className="spin" aria-hidden /> : <Send size={15} aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (project: Project) => void }) {
  const { preferences, t } = useI18n();
  const [form, setForm] = useState({
    name: "", objective: "", context: "", scope: "", constraints: "", budget: "",
    reviewGates: "", outputRequirements: "", outputLanguage: "en"
  });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const payload = await api<{ data: Project }>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          objective: form.objective,
          context: form.context,
          scope: form.scope,
          constraints: form.constraints.split("\n").map((item) => item.trim()).filter(Boolean),
          budgetCents: form.budget
            ? Math.round(Number(form.budget) * (preferences.currency === "KRW" ? 1 : 100))
            : null,
          budgetCurrency: preferences.currency,
          reviewGates: form.reviewGates.split("\n").map((item) => item.trim()).filter(Boolean),
          outputRequirements: form.outputRequirements.split("\n").map((item) => item.trim()).filter(Boolean),
          outputLanguage: form.outputLanguage,
          permissions: {
            externalSend: "review_required",
            clientDataWrite: "review_required",
            destructiveAction: "review_required"
          }
        })
      });
      onCreated(payload.data);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal labelledBy="create-project-title" onClose={onClose} className="dialog" dismissOnBackdrop={false}>
      <form onSubmit={submit}>
        <div className="dialog-head">
          <div>
            <span className="eyebrow">{t("New project")}</span>
            <h2 id="create-project-title">{t("Create durable project context")}</h2>
          </div>
          <button type="button" className="icon-only" onClick={onClose} aria-label={t("Close dialog")}>
            <X size={17} aria-hidden />
          </button>
        </div>
        {formError && <div className="field-error" role="alert">{formError}</div>}
        <div className="form-grid">
          <label>{t("Project name")} <em aria-hidden>{t("required")}</em>
            <input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>{t("Budget")} ({preferences.currency})
            <input type="number" min="0" inputMode="decimal" placeholder={t("Optional")} value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value })} />
          </label>
          <label>{t("Output language")}
            <select value={form.outputLanguage} onChange={(event) => setForm({ ...form, outputLanguage: event.target.value })}>
              <option value="en">{t("English")}</option>
              <option value="ko">한국어</option>
              <option value="bilingual">{t("English + Korean")}</option>
            </select>
          </label>
          <label className="span-2">{t("Objective")} <em aria-hidden>{t("required")}</em>
            <textarea required minLength={10} rows={3} value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} />
          </label>
          <label>{t("Context")}
            <textarea rows={4} value={form.context} onChange={(event) => setForm({ ...form, context: event.target.value })} />
          </label>
          <label>{t("Scope")}
            <textarea rows={4} value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })} />
          </label>
          <label className="span-2">{t("Constraints")} <span>{t("One per line")}</span>
            <textarea rows={4} value={form.constraints} onChange={(event) => setForm({ ...form, constraints: event.target.value })} />
          </label>
          <label>{t("Review gates")} <span>{t("One per line")}</span>
            <textarea rows={4} value={form.reviewGates} onChange={(event) => setForm({ ...form, reviewGates: event.target.value })} />
          </label>
          <label>{t("Output requirements")} <span>{t("One per line")}</span>
            <textarea rows={4} value={form.outputRequirements} onChange={(event) => setForm({ ...form, outputRequirements: event.target.value })} />
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>{t("Cancel")}</button>
          <button className="primary" disabled={busy}>{busy && <Loader2 size={14} className="spin" aria-hidden />}{t("Create project")}</button>
        </div>
      </form>
    </Modal>
  );
}

const AGENDA_TYPES: AgendaWorkType[] = [
  "custom", "research", "marketing", "brainstorming", "content",
  "data_enrichment", "document", "communication", "analysis", "operations"
];

/** Derives a readable agenda title: first sentence, trimmed on a word boundary. */
function agendaTitle(instruction: string) {
  const clean = instruction.trim().replace(/\s+/g, " ");
  const sentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  const candidate = sentence.replace(/[.!?]+$/, "");
  if (candidate.length <= 80) return candidate;
  const cut = candidate.slice(0, 80);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 40 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
