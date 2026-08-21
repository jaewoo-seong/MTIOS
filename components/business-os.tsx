"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Archive,
  ArchiveRestore,
  Bot,
  CircleAlert,
  CircleHelp,
  Database,
  FileText,
  FolderKanban,
  Loader2,
  LogOut,
  Mail,
  Mic,
  MicOff,
  Plus,
  Search,
  Settings,
  Sparkles,
  X
} from "lucide-react";
import type { Agenda, Deliverable, Milestone, Project, ProjectRecord, WorkspaceDocument } from "@/lib/domain";
import { ResearchProjectWorkspace } from "@/components/research-project-workspace";
import { SearchPalette } from "@/components/search-palette";
import { BrandLogo } from "@/components/brand-logo";
import { HelpLink, useHelp } from "@/components/help-provider";
import type { HelpArticleId } from "@/lib/help/content";
import { Modal } from "@/components/ui/modal";
import { useI18n, type RegionalPreferences } from "@/lib/i18n";
import {
  AdminUsersSettings,
  AiAnalyticsSettings,
  ExternalMcpSettings,
  OrganizationProfileSettings,
  PasswordSettings
} from "@/components/account-settings";

const DocumentsView = dynamic(() => import("@/components/documents-view").then((module) => module.DocumentsView), {
  loading: () => <LoadingState />
});
const ClientDataView = dynamic(() => import("@/components/client-data-view").then((module) => module.ClientDataView), {
  loading: () => <LoadingState />
});

type PageId = "projects" | "documents" | "data" | "settings";
type ProjectDetail = Project & {
  agendas: Agenda[];
  milestones: Milestone[];
  records: ProjectRecord[];
  deliverables: Deliverable[];
};
type AppSession = {
  user: { id: string; name: string; username: string; role: "admin" | "member" };
};

const navItems: Array<{ id: PageId; label: string; icon: typeof Bot }> = [
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "data", label: "Client Databases", icon: Database },
  { id: "settings", label: "Settings", icon: Settings }
];

const pageCopy: Record<PageId, { title: string; subtitle: string }> = {
  projects: {
    title: "Research Projects",
    subtitle: "Strategy, continuous company research, and master dossiers"
  },
  documents: {
    title: "Documents",
    subtitle: "Working project outputs and saved reports"
  },
  data: {
    title: "Client Databases",
    subtitle: "One company database per research project"
  },
  settings: {
    title: "Settings",
    subtitle: "Workspace governance, models, tools, and approval policy"
  }
};

/** The help topic each module opens from its header. */
const pageHelp: Record<PageId, HelpArticleId> = {
  projects: "starting-a-project",
  documents: "documents",
  data: "client-databases",
  settings: "model-routing"
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
  const [page, setPage] = useState<PageId>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [documentCount, setDocumentCount] = useState(0);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Array<{ id: number; message: string }>>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusDocumentId, setFocusDocumentId] = useState<string | null>(null);
  const [focusDatabaseId, setFocusDatabaseId] = useState<string | null>(null);
  const [focusProjectDocumentsId, setFocusProjectDocumentsId] = useState<string | null>(null);
  const [session, setSession] = useState<AppSession | null>(null);
  const { openHelp, registerNavigator } = useHelp();

  const readLocation = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view") as PageId | null;
    if (view && navItems.some((item) => item.id === view)) setPage(view);
    const projectId = params.get("project");
    if (projectId) setSelectedProjectId(projectId);
    const documentId = params.get("document");
    if (documentId) {
      setFocusDocumentId(documentId);
      setPage("documents");
    }
    const databaseId = params.get("database");
    if (databaseId) { setFocusDatabaseId(databaseId); setPage("data"); }
    const projectDocumentsId = params.get("projectDocuments");
    if (projectDocumentsId) { setFocusProjectDocumentsId(projectDocumentsId); setPage("documents"); }
  }, []);

  const navigatePage = useCallback((next: PageId, options: { documentId?: string | null; databaseId?: string | null; projectDocumentsId?: string | null } = {}) => {
    setPage(next);
    if (options.documentId) setFocusDocumentId(options.documentId);
    setFocusDatabaseId(options.databaseId ?? null);
    setFocusProjectDocumentsId(options.projectDocumentsId ?? null);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    if (options.documentId) url.searchParams.set("document", options.documentId);
    else url.searchParams.delete("document");
    if (options.databaseId) url.searchParams.set("database", options.databaseId);
    else url.searchParams.delete("database");
    if (options.projectDocumentsId) url.searchParams.set("projectDocuments", options.projectDocumentsId);
    else url.searchParams.delete("projectDocuments");
    window.history.pushState({}, "", url);
  }, []);

  useEffect(() => {
    readLocation();
    window.addEventListener("popstate", readLocation);
    return () => window.removeEventListener("popstate", readLocation);
  }, [readLocation]);

  // Lets tour steps switch modules without the help layer owning navigation.
  useEffect(() => { registerNavigator(navigatePage); }, [registerNavigator, navigatePage]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("project") === selectedProjectId) return;
    url.searchParams.set("project", selectedProjectId);
    window.history.replaceState({}, "", url);
  }, [selectedProjectId]);

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

  const loadDocumentCount = useCallback(async () => {
    const payload = await api<{ data: WorkspaceDocument[] }>("/api/v1/documents");
    setDocumentCount(payload.data.length);
  }, []);

  useEffect(() => {
    Promise.all([loadProjects(), loadDocumentCount()])
      .catch((reason: Error) => pushError(reason.message))
      .finally(() => setLoading(false));
  }, [loadProjects, loadDocumentCount, pushError]);

  useEffect(() => {
    // A session check failing here means the cookie expired or was revoked
    // between the last full page load and now — the same condition the 30
    // minute refresh below already treats as "go log in again," not as a
    // dismissible error. Bundling this into the Promise.all above used to
    // surface the raw "unauthorized" API error string as a toast instead.
    api<{ data: AppSession }>("/api/v1/auth/session")
      .then((payload) => setSession(payload.data))
      .catch(() => window.location.assign("/login"));
  }, []);

  useEffect(() => {
    const refresh = window.setInterval(() => {
      api<{ data: AppSession }>("/api/v1/auth/session")
        .then((payload) => setSession(payload.data))
        .catch(() => window.location.assign("/login"));
    }, 30 * 60 * 1000);
    return () => window.clearInterval(refresh);
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedProject(null);
      return;
    }
    api<{ data: ProjectDetail }>(`/api/v1/projects/${selectedProjectId}`)
      .then((payload) => setSelectedProject(payload.data))
      .catch((reason: Error) => pushError(reason.message));
  }, [selectedProjectId, projects, pushError]);

  const navCounts: Partial<Record<PageId, number>> = {
    projects: projects.filter((project) => project.status === "active").length,
    documents: documentCount
  };

  // ⌘K / Ctrl+K opens search from anywhere, as the top bar advertises.
  // "?" for help is handled by HelpProvider.
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

  return (
    <div className="app-shell">
      {process.env.NEXT_PUBLIC_UI_AUDIT_MODE === "true" && (
        <div className="ui-audit-banner" role="status">Development UI audit mode · fixture data · no production access</div>
      )}
      <aside className="sidebar" data-help-anchor="sidebar-nav">
        <div className="brand">
          <div className="brand-mark"><BrandLogo alt="" priority /></div>
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
                data-help-anchor={`nav-${item.id}`}
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => navigatePage(item.id)}
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
            <strong>{session?.user.name ?? "MTI Korea"}</strong>
            <span>{session?.user.role ?? t("Single workspace")}</span>
          </div>
          <button
            className="icon-button"
            title="Sign out"
            onClick={() => void api("/api/v1/auth/logout", { method: "POST" }).finally(() => window.location.assign("/login"))}
          ><LogOut size={14} /></button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{t(pageCopy[page].title)} <HelpLink article={pageHelp[page]} title={t("How this module works")} anchor="module-help" /></h1>
            <p>{t(pageCopy[page].subtitle)}</p>
          </div>
          <div className="topbar-actions">
            <button className="search-trigger" onClick={() => setSearchOpen(true)}>
              <Search size={15} aria-hidden /> {t("Search")}
              <kbd>⌘K</kbd>
            </button>
            <button className="help-trigger" aria-label={t("Help and tutorials")} title={t("Help and tutorials")} onClick={() => openHelp()}>
              <CircleHelp size={15} aria-hidden /> <kbd>?</kbd>
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
              {page === "projects" && (
                <ProjectsView
                  projects={projects}
                  project={selectedProject}
                  selectedId={selectedProjectId}
                  onSelect={setSelectedProjectId}
                  onCreate={() => setCreateOpen(true)}
                  onError={pushError}
                  onProjectsChanged={loadProjects}
                  onOpenDocument={(documentId) => {
                    navigatePage("documents", { documentId });
                  }}
                  onOpenDatabase={(databaseId) => navigatePage("data", { databaseId })}
                  onOpenProjectDocuments={(projectId) => navigatePage("documents", { projectDocumentsId: projectId })}
                />
              )}
              {page === "documents" && (
                <DocumentsView
                  onError={pushError}
                  projects={projects}
                  focusDocumentId={focusDocumentId}
                  onFocusHandled={() => setFocusDocumentId(null)}
                  focusProjectId={focusProjectDocumentsId}
                  onClearProjectFocus={() => setFocusProjectDocumentsId(null)}
                />
              )}
              {page === "data" && (
                <ClientDataView
                  onError={pushError}
                  projects={projects}
                  focusDatabaseId={focusDatabaseId}
                  onOpenDocument={(documentId) => {
                    navigatePage("documents", { documentId });
                  }}
                />
              )}
              {page === "settings" && <SettingsView onError={pushError} role={session?.user.role ?? "member"} />}
            </>
          )}
        </section>

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
              setPage("documents");
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

function ProjectsView({ projects, project, selectedId, onSelect, onCreate, onError, onProjectsChanged, onOpenDocument, onOpenDatabase, onOpenProjectDocuments }: {
  projects: Project[];
  project: ProjectDetail | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onError: (message: string) => void;
  onProjectsChanged: () => Promise<void>;
  onOpenDocument: (documentId: string) => void;
  onOpenDatabase: (databaseId: string) => void;
  onOpenProjectDocuments: (projectId: string) => void;
}) {
  const { t } = useI18n();
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState(false);
  if (projects.length === 0) {
    return <EmptyModule icon={FolderKanban} title={t("No projects")} text={t("Create a project to establish context, constraints, agendas, and output requirements.")} action={t("Create project")} onAction={onCreate} help="starting-a-project" />;
  }

  const archivedCount = projects.filter((item) => item.status === "archived").length;
  // The selected project stays visible even when it's archived and the filter
  // is off, so archiving the project you're looking at doesn't yank it out
  // from under you.
  const visibleProjects = projects.filter((item) =>
    showArchived || item.status !== "archived" || item.id === selectedId
  );

  async function setArchived(target: boolean) {
    if (!project) return;
    setArchiving(true);
    try {
      const response = await fetch(`/api/v1/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target ? "archived" : "active" })
      });
      if (!response.ok) throw new Error(target ? "Could not archive the project." : "Could not restore the project.");
      await onProjectsChanged();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Could not update the project.");
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="project-layout">
      <aside className="project-list" data-help-anchor="project-list">
        <div className="list-heading">
          <span>{t("Projects")}</span>
          <button onClick={onCreate} aria-label={t("Create project")} title={t("Create project")}><Plus size={14} /></button>
        </div>
        {visibleProjects.map((item) => (
          <button key={item.id} className={selectedId === item.id ? "project-row selected" : "project-row"} onClick={() => onSelect(item.id)}>
            <strong>{item.name}</strong>
            <span>{t(item.status)}</span>
          </button>
        ))}
        {archivedCount > 0 && (
          <button className="quiet project-list-toggle" onClick={() => setShowArchived((value) => !value)}>
            {showArchived ? t("Hide archived") : t("Show archived ({count})", { count: archivedCount })}
          </button>
        )}
      </aside>
      {project && (
        <div className="project-center">
          <div className="project-lifecycle-toolbar">
            <span className={`pill ${project.status === "active" ? "good" : ""}`}>{t(project.status)}</span>
            <button className="quiet" onClick={() => void setArchived(project.status !== "archived")} disabled={archiving}>
              {archiving ? <Loader2 size={13} className="spin" aria-hidden /> : project.status === "archived" ? <ArchiveRestore size={13} aria-hidden /> : <Archive size={13} aria-hidden />}
              {project.status === "archived" ? t("Restore") : t("Archive")}
            </button>
          </div>
          <ResearchProjectWorkspace
            project={project}
            onError={onError}
            onOpenDocument={onOpenDocument}
            onOpenDatabase={onOpenDatabase}
            onOpenProjectDocuments={onOpenProjectDocuments}
          />
        </div>
      )}
    </div>
  );
}


function SettingsView({ onError, role }: {
  onError: (message: string) => void;
  role: "admin" | "member";
}) {
  const { t } = useI18n();
  // Tabs rather than one long scroll: the sections answer different questions
  // ("is it working", "what is it costing", "who can do what") and mixing them
  // in one column meant scanning past AI internals to change a date format.
  const tabs = role === "admin"
    ? ["status", "models", "intelligence", "tools", "access", "workspace"] as const
    : ["workspace"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  const label: Record<string, string> = {
    status: t("Status"),
    models: t("Models & cost"),
    intelligence: t("AI analysis"),
    tools: t("Tools"),
    access: t("Access"),
    workspace: t("Workspace")
  };

  return (
    <div className="settings-shell">
      {tabs.length > 1 && (
        <div className="settings-tabs" role="tablist" aria-label={t("Settings sections")}>
          {tabs.map((item) => (
            <button
              key={item}
              role="tab"
              id={`settings-tab-${item}`}
              aria-selected={tab === item}
              aria-controls={`settings-panel-${item}`}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {label[item]}
            </button>
          ))}
        </div>
      )}

      <div
        className="settings-grid"
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
      >
        {tab === "status" && <SystemStatusSettings onError={onError} />}
        {tab === "models" && <ModelSettings onError={onError} />}
        {tab === "intelligence" && <AiAnalyticsSettings onError={onError} />}
        {tab === "tools" && (
          <>
            <SettingsSectionIntro
              eyebrow="Tools"
              title="Connected capabilities"
              description="Manage the systems that extend Business OS, the company context they use, and automated notification delivery."
              items={["Company context", "MCP tool inventory", "Email notifications"]}
            />
            <OrganizationProfileSettings onError={onError} />
            <div className="settings-tool-columns settings-wide">
              <McpSettings onError={onError} />
              <GmailSettings onError={onError} />
            </div>
          </>
        )}
        {tab === "access" && (
          <>
            <SettingsSectionIntro
              eyebrow="Access"
              title="People, credentials, and permissions"
              description="Control who can enter the workspace, which external assistants can connect, and which actions require review."
              items={["Administrators & members", "External MCP credentials", "Approval safeguards"]}
            />
            <AdminUsersSettings onError={onError} />
            <ExternalMcpSettings onError={onError} />
            <section className="surface settings-wide">
              <div className="surface-header"><div><h2>{t("Review policy")}</h2><span>Safeguards for actions with external or irreversible impact</span></div></div>
              <div className="access-policy-grid">
                <Setting label={t("External sends")} value={t("Approval required")} />
                <Setting label={t("Destructive writes")} value={t("Approval required")} />
                <Setting label={t("High-cost actions")} value={t("Approval required")} />
              </div>
            </section>
          </>
        )}
        {tab === "workspace" && (
          <>
            <PreferenceSettings onError={onError} />
            {role === "member" && <PasswordSettings onError={onError} />}
          </>
        )}
      </div>
    </div>
  );
}

function SettingsSectionIntro({ eyebrow, title, description, items }: {
  eyebrow: string;
  title: string;
  description: string;
  items: string[];
}) {
  return (
    <header className="settings-section-intro settings-wide">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </header>
  );
}

type SystemStatus = {
  services: Array<{ key: string; name: string; state: string; detail: string }>;
  providers: Array<{
    key: string; name: string; categories: string[]; state: string;
    keys: Array<{ name: string; present: boolean; state?: string; checkedAt?: string | null; usage?: { remaining?: number | null; limit?: number | null; used?: number | null; plan?: string | null; periodEnd?: string | null } }>; role: string | null;
  }>;
  models: Array<{
    route: string; purpose: string; modelEnv: string | null; model: string | null;
    pricingClass: string | null; maxCostMicros: number; structuredOutput: boolean;
  }>;
  environment: string;
  testingMode: boolean;
};

/** Maps a raw state to the shared pill classes, so colour means one thing everywhere. */
function stateTone(state: string) {
  if (state === "ok" || state === "configured") return "good";
  if (state === "not_configured") return "warn";
  return "bad";
}

function SystemStatusSettings({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    api<{ data: SystemStatus }>("/api/v1/settings/status")
      .then((payload) => setStatus(payload.data))
      .catch((error: Error) => onError(error.message));
  }, [onError]);

  if (!status) {
    return <section className="surface settings-wide"><div className="empty-inline">{t("Loading status…")}</div></section>;
  }

  const degraded = status.services.filter((service) => service.state !== "ok" && service.state !== "configured");

  return (
    <>
      <section className="surface settings-wide">
        <div className="surface-header">
          <h2>{t("Service status")}</h2>
          <span className={degraded.length === 0 ? "pill good" : "pill warn"}>
            {degraded.length === 0
              ? t("All services reachable")
              : t("{count} need attention", { count: String(degraded.length) })}
          </span>
        </div>
        <div className="status-cards">
          {status.services.map((service) => (
            <div className="status-card" key={service.key}>
              <div className="status-card-head">
                <strong>{service.name}</strong>
                <span className={`pill ${stateTone(service.state)}`}>{t(service.state)}</span>
              </div>
              <p>{t(service.detail)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="surface settings-wide">
        <div className="surface-header">
          <h2>{t("Search & data providers")}</h2>
          <span>{t("Keys are validated and credit balances refresh at most once per hour")}</span>
        </div>
        <div className="status-cards">
          {status.providers.map((provider) => (
            <div className="status-card" key={provider.key}>
              <div className="status-card-head">
                <strong>{provider.name}</strong>
                <span className={`pill ${stateTone(provider.state)}`}>{t(provider.state)}</span>
              </div>
              {provider.role && <p>{provider.role}</p>}
              <ul className="status-keys">
                {provider.keys.map((key) => (
                  <li key={key.name}>
                    <span className={key.state === "ok" ? "dot on" : "dot off"} aria-hidden />
                    <code>{key.name}</code>
                    <span>{t(key.state ?? (key.present ? "set" : "missing"))}{key.usage && typeof key.usage.remaining === "number" ? ` · ${key.usage.remaining.toLocaleString()} credits left` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
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
  catalog: Array<{ gatewayModel: string; model: string; label: string }>;
  routes: Array<{
    route: string; purpose: string; maxCostMicros: number; structuredOutput: boolean; recommendedGatewayModel: string;
    selectionMode: "auto" | "manual"; activeGatewayModel: string;
    candidates: Array<{ order: number; provider: "openrouter" | "nvidia"; model: string; modelEnv: string; gatewayModel: string; selectionMode: "auto" | "manual"; pricingClass: "paid" | "free"; productionApproved: boolean; licensingStatus: "approved" | "testing_only" | "unverified"; strengths: string[]; languages: string[]; supportsStructuredOutput: boolean; supportsTools: boolean; longContext: boolean; enabled: boolean }>;
  }>;
};

function ModelSettings({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState<ModelSettingsPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { gatewayModel: string; mode: "auto" | "manual" }>>({});
  const lastSuccessful = value?.recentCalls.find((call) => !call.error);
  const pendingRevisions = value?.revisions.filter((revision) => ["draft", "approved"].includes(revision.status)) ?? [];
  const load = useCallback(() => api<ModelSettingsPayload>("/api/v1/settings/models").then((payload) => {
    setValue(payload);
    setDrafts(Object.fromEntries(payload.routes.map((route) => [
      route.route,
      {
        gatewayModel: route.activeGatewayModel,
        mode: route.selectionMode
      }
    ])));
  }), []);
  useEffect(() => { load().catch((error: Error) => onError(error.message)); }, [load, onError]);
  async function createAndActivate(route: ModelSettingsPayload["routes"][number], mode = drafts[route.route]?.mode ?? "manual", selectedGatewayModel = drafts[route.route]?.gatewayModel) {
      const draft = drafts[route.route];
      const selected = route.candidates.find((candidate) =>
        candidate.gatewayModel.replace(/^auto:/, "") === selectedGatewayModel
      ) ?? route.candidates[0];
      const candidates = mode === "auto" ? route.candidates : selected ? [selected] : [];
      const revision = await api<{ data: { id: string } }>("/api/v1/settings/models/revisions", {
        method: "POST",
        body: JSON.stringify({
          route: route.route,
          maxCostMicros: route.maxCostMicros,
          structuredOutput: route.structuredOutput,
          candidates: candidates.map(({ provider, modelEnv, gatewayModel, pricingClass, productionApproved, licensingStatus, strengths, languages, supportsStructuredOutput, supportsTools, longContext }) => ({
            provider, modelEnv,
            gatewayModel: mode === "auto" ? `auto:${gatewayModel.replace(/^auto:/, "")}` : (selectedGatewayModel ?? draft?.gatewayModel ?? gatewayModel.replace(/^auto:/, "")),
            pricingClass, productionApproved, licensingStatus, strengths, languages,
            supportsStructuredOutput, supportsTools, longContext
          }))
        })
      });
      for (const action of ["test", "approve", "activate"] as const) {
        await api(`/api/v1/settings/models/revisions/${revision.data.id}`, { method: "POST", body: JSON.stringify({ action }) });
      }
  }
  async function applyRoute(route: ModelSettingsPayload["routes"][number], mode: "auto" | "manual", gatewayModel?: string) {
    setBusy(route.route);
    try {
      await createAndActivate(route, mode, gatewayModel);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Model route could not be applied.");
    } finally {
      setBusy(null);
    }
  }
  async function applyAutoAll() {
    if (!value) return;
    setBusy("all");
    try {
      await api("/api/v1/settings/models/auto", { method: "POST" });
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Automatic routing could not be applied to every worker."); }
    finally { setBusy(null); }
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
      <div className="surface-header model-routing-head"><div><h2>{t("Model routing")}</h2><span>{t("Choose automatic recommendations or pin a model for each job.")}</span></div>{value && <div className="surface-actions"><span className={`pill ${value.health === "ok" ? "good" : "warn"}`}>{t(value.health)}</span><button className="primary" disabled={busy !== null} onClick={() => void applyAutoAll()}>{busy === "all" && <Loader2 size={13} className="spin" />} {t("Auto-select all workers")}</button></div>}</div>
      {!value ? <div className="empty-inline">{t("Loading model routes…")}</div> : (
        <div className="model-routes">
          {value.routes.filter((route) => !route.route.startsWith("multilingual_")).map((route) => {
            const draft = drafts[route.route];
            const configurable = route.route.startsWith("worker_");
            // The picker can only offer models from this route's own pool, so
            // the pinned value is resolved against that pool rather than taken
            // from the draft blindly.
            const options = route.candidates.map((candidate) => candidate.gatewayModel.replace(/^auto:/, ""));
            const manualModel = [draft?.gatewayModel, route.activeGatewayModel]
              .find((model): model is string => Boolean(model) && options.includes(model as string))
              ?? options[0] ?? route.activeGatewayModel;
            return <div className="model-route-card" key={route.route}>
              <div className="model-route-id">
                <strong>{friendlyRouteName(route.route)}</strong>
                <span>{t(route.purpose)}</span>
              </div>
              <div className="model-route-choice">
                {configurable ? <div className="segmented-control model-mode" role="group" aria-label={t("Model selection mode")}>
                  <button className={draft?.mode === "auto" ? "active" : ""} disabled={busy !== null} onClick={() => {
                    if (draft?.mode === "auto") return;
                    if (!window.confirm(t("Return this job to automatic model selection? The pinned model will no longer be used."))) return;
                    setDrafts((current) => ({ ...current, [route.route]: { ...current[route.route], mode: "auto", gatewayModel: route.recommendedGatewayModel } }));
                    void applyRoute(route, "auto", route.recommendedGatewayModel);
                  }}>{t("Auto")}</button>
                  <button className={draft?.mode === "manual" ? "active" : ""} disabled={busy !== null} onClick={() => {
                    if (draft?.mode === "manual") return;
                    setDrafts((current) => ({ ...current, [route.route]: { ...current[route.route], mode: "manual", gatewayModel: manualModel } }));
                    void applyRoute(route, "manual", manualModel);
                  }}>{t("Manual")}</button>
                </div> : <span className="pill">{t("Managed premium route")}</span>}
                {configurable && draft?.mode === "manual" ? (
                  <select className="model-picker" aria-label={t("Serving model")} disabled={busy !== null} value={manualModel} onChange={(event) => { const gatewayModel = event.target.value; setDrafts((current) => ({
                      ...current,
                      [route.route]: { ...current[route.route], gatewayModel }
                    })); void applyRoute(route, "manual", gatewayModel); }}>
                      {route.candidates.map((candidate) => {
                        const gatewayModel = candidate.gatewayModel.replace(/^auto:/, "");
                        const label = value.catalog.find((item) => item.gatewayModel === gatewayModel)?.label ?? gatewayModel;
                        return <option key={gatewayModel} value={gatewayModel}>{label}</option>;
                      })}
                    </select>
                ) : <div className="model-auto-result"><Sparkles size={14} /><span>{t("Selects per task from {count} eligible models", { count: route.candidates.length })}</span></div>}
              </div>
              <div className="model-route-actions">
                {busy === route.route && <span className="model-route-saving"><Loader2 size={13} className="spin" /> {t("Updating")}</span>}
              </div>
            </div>})}
          {/* The cost-cap and structured-output controls are gone, so the strip
              explains only what an operator can still change here. */}
          <div className="model-help-strip">
            <div><strong>{t("Auto")}</strong><span>{t("Scores eligible models for each individual task using language, tools, structure, context, quality, quota, and availability.")}</span></div>
            <div><strong>{t("Manual")}</strong><span>{t("Pins one model for every task on this job. Switching back to Auto asks for confirmation.")}</span></div>
            <div><strong>{t("Safe apply")}</strong><span>{t("Tests every candidate before atomically activating all automatic worker policies.")}</span></div>
          </div>
        </div>
      )}
      {/* Pending revisions were previously appended to the route list, so a
          staged change looked like another route. They are a queue of things
          awaiting a decision, which is a different kind of thing. */}
      {value && pendingRevisions.length > 0 && (
        <div className="settings-block">
          <h3>{t("Pending route changes")}</h3>
          <div className="model-routes">
            {pendingRevisions.map((revision) => (
              <div className="model-route" key={revision.id}>
                <div className="model-route-id">
                  <strong>{revision.route} v{revision.version}</strong>
                  <span>{t(revision.status)} · {t("test")} {t(revision.testStatus)}</span>
                </div>
                <div className="model-route-serving" />
                <div className="model-route-controls">
                  {revision.testStatus !== "passed" && <button className="secondary" disabled={busy !== null} onClick={() => void transition(revision.id, "test")}>{t("Test")}</button>}
                  {revision.testStatus === "passed" && revision.status === "draft" && <button className="secondary" disabled={busy !== null} onClick={() => void transition(revision.id, "approve")}>{t("Approve")}</button>}
                  {revision.status === "approved" && <button className="primary" disabled={busy !== null} onClick={() => void transition(revision.id, "activate")}>{t("Activate")}</button>}
                  {revision.status === "active" && <button className="secondary" disabled={busy !== null} onClick={() => void transition(revision.id, "rollback")}>{t("Rollback")}</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {lastSuccessful && (
        <div className="settings-block">
          <h3>{t("Most recent successful call")}</h3>
          <div className="metric-row">
            <div><span className="eyebrow">{t("Route")}</span><strong>{lastSuccessful.route}</strong></div>
            <div><span className="eyebrow">{t("Model")}</span><strong>{lastSuccessful.model ?? t("unknown")}</strong></div>
            <div><span className="eyebrow">{t("Latency")}</span><strong>{lastSuccessful.latencyMs} ms</strong></div>
            <div><span className="eyebrow">{t("Cost")}</span><strong>${(lastSuccessful.costMicros / 1_000_000).toFixed(4)}</strong></div>
          </div>
        </div>
      )}
    </section>
  );
}

function friendlyRouteName(route: string) {
  return ({ executive_reasoning: "Premium strategist", executive_review: "Premium reviewer", premium_fallback: "GPT Luna fallback", worker_research: "Company research", worker_creative: "Creative work", worker_writing: "Dossier writing", worker_editing: "Editing", worker_structured: "Data extraction", worker_translation: "Translation", worker_fast: "Quick classification" } as Record<string, string>)[route] ?? route.replaceAll("_", " ");
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
    <section className="surface">
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
  isServiceSender: boolean;
  serviceSenderSetAt: string | null;
};

function GmailSettings({ onError }: { onError: (message: string) => void }) {
  const { t } = useI18n();
  const [connections, setConnections] = useState<GmailConnection[]>([]);
  const [oauthConfigured, setOauthConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [notifications, setNotifications] = useState<Array<{
    id: string; toAddress: string; subject: string; status: string; attempts: number;
    lastError: string | null; sentAt: string | null; createdAt: string;
  }>>([]);

  const load = useCallback(async () => {
    const [response, notificationResponse] = await Promise.all([
      fetch("/api/v1/integrations/gmail"),
      fetch("/api/v1/admin/notifications")
    ]);
    if (!response.ok) throw new Error("Could not load Gmail connections.");
    const payload = (await response.json()) as { data: GmailConnection[] };
    setConnections(payload.data);
    if (notificationResponse.ok) {
      const notificationPayload = (await notificationResponse.json()) as { data: typeof notifications };
      setNotifications(notificationPayload.data);
    }
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

  async function makeServiceSender(connectionId: string) {
    setBusy(true);
    try {
      await api("/api/v1/admin/gmail-service-sender", {
        method: "POST", body: JSON.stringify({ connectionId })
      });
      await load();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Service sender could not be configured.");
    } finally { setBusy(false); }
  }

  async function sendTest() {
    setBusy(true);
    try {
      await api("/api/v1/admin/notifications/test", {
        method: "POST", body: JSON.stringify({ email: testEmail })
      });
      await load();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Test notification could not be sent.");
    } finally { setBusy(false); }
  }

  async function retryNotification(notificationId: string) {
    setBusy(true);
    try {
      await api(`/api/v1/admin/notifications/${notificationId}/retry`, { method: "POST" });
      await load();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Notification retry could not start.");
    } finally { setBusy(false); }
  }

  return (
    <section className="surface integration-settings">
      <div className="surface-header">
        <div>
          <h2>{t("Gmail")}</h2>
          <span>Connect the administrator mailbox once, then designate it as the Business OS service sender · {t(oauthConfigured ? "OAuth configured" : "OAuth not configured")}</span>
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
            <span>{t(connection.status)} · Automated notification sending only{connection.isServiceSender ? " · Service sender" : ""}</span>
          </div>
          {!connection.isServiceSender && connection.status === "active" && <button className="secondary" onClick={() => void makeServiceSender(connection.id)} disabled={busy}>Use for notifications</button>}
          <button
            className="secondary"
            onClick={() => void disconnect(connection.id)}
            disabled={busy || connection.status === "revoked"}
          >
            {t("Disconnect")}
          </button>
        </div>
      ))}
      <div className="settings-form">
        <label>Send test notification<input type="email" placeholder="recipient@example.com" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} /></label>
        <button className="secondary" disabled={busy || !testEmail.includes("@") || !connections.some((item) => item.isServiceSender && item.status === "active")} onClick={() => void sendTest()}><Mail size={14} /> Send test</button>
      </div>
      <div className="admin-table">
        {notifications.slice(0, 20).map((item) => <div className="integration-row" key={item.id}>
          <div><strong>{item.subject}</strong><span>{item.toAddress} · {item.status} · {item.attempts} attempt(s){item.lastError ? ` · ${item.lastError}` : ""}</span></div>
          <time>{new Date(item.sentAt ?? item.createdAt).toLocaleString()}</time>
          {item.status === "failed" && item.attempts < 5 && <button className="secondary" disabled={busy} onClick={() => void retryNotification(item.id)}>Retry</button>}
        </div>)}
      </div>
      <p className="integration-policy">Only the designated service sender may send automated messages. Mailbox deletion remains unavailable.</p>
    </section>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return <div className="setting"><span>{label}</span><strong>{value}</strong></div>;
}

function EmptyModule({ icon: Icon, title, text, action, onAction, help }: {
  icon: typeof Bot;
  title: string;
  text: string;
  action: string;
  onAction?: () => void;
  help?: HelpArticleId;
}) {
  const { t } = useI18n();
  return (
    <div className="empty-module">
      <div className="empty-icon"><Icon size={22} /></div>
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="primary" onClick={onAction}><Plus size={14} />{action}</button>
      {help && <HelpLink article={help} label={t("How this works")} />}
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
  const [brief, setBrief] = useState("");
  const [organizing, setOrganizing] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  async function organizeBrief() {
    setOrganizing(true); setFormError(null);
    try {
      const payload = await api<{ data: { name: string; objective: string; context: string; scope: string; constraints: string[]; budget: string; reviewGates: string[]; outputRequirements: string[]; outputLanguage: "en" | "ko" | "bilingual" | "" } }>("/api/v1/projects/organize-brief", { method: "POST", body: JSON.stringify({ brief }) });
      const data = payload.data;
      setForm({ name: data.name, objective: data.objective, context: data.context, scope: data.scope, constraints: data.constraints.join("\n"), budget: data.budget, reviewGates: data.reviewGates.join("\n"), outputRequirements: data.outputRequirements.join("\n"), outputLanguage: data.outputLanguage || "en" });
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Could not organize the brief."); }
    finally { setOrganizing(false); }
  }

  function toggleDictation() {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const SpeechRecognition = (window as typeof window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
      ?? (window as typeof window & { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SpeechRecognition) { setFormError("Audio dictation is not supported by this browser."); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = true; recognition.interimResults = false; recognition.lang = "en-US";
    recognition.onresult = (event) => setBrief((current) => `${current}${current ? " " : ""}${Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ")}`);
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition; recognition.start(); setListening(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const payload = await api<{ data: Project; strategyBootstrap?: { status: "proposed" | "failed"; error?: string } }>("/api/v1/projects", {
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
    <Modal labelledBy="create-project-title" onClose={onClose} className="dialog project-create-dialog" backdropClassName="dialog-backdrop fullscreen-dialog-backdrop" dismissOnBackdrop={false}>
      <form onSubmit={submit} className="project-create-form">
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
        <div className="project-create-layout">
          <section className="project-brief-panel">
            <span className="eyebrow">{t("AI intake")}</span>
            <h3>{t("Describe the whole research assignment")}</h3>
            <p>{t("Paste or dictate the client brief. A free structuring model will organize only the information you supplied; missing fields stay blank.")}</p>
            <textarea rows={16} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder={t("Market, geography, ideal companies, qualification rules, services, constraints, required dossier sections…")} />
            <div className="project-brief-actions">
              <button type="button" className={listening ? "secondary active" : "secondary"} onClick={toggleDictation}>{listening ? <MicOff size={14} /> : <Mic size={14} />} {t(listening ? "Stop dictation" : "Dictate")}</button>
              <button type="button" className="primary" disabled={organizing || brief.trim().length < 10} onClick={() => void organizeBrief()}>{organizing ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {t("Organize with AI")}</button>
            </div>
          </section>
          <div className="form-grid project-fields">
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
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>{t("Cancel")}</button>
          <button className="primary" disabled={busy}>{busy && <Loader2 size={14} className="spin" aria-hidden />}{t(busy ? "Creating project and first strategy…" : "Create project")}</button>
        </div>
      </form>
    </Modal>
  );
}

type SpeechRecognitionLike = {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((event: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void;
};
