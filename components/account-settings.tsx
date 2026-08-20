"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  credentialedResearchProviderKeys,
  credentialedResearchProviderLabels,
  providerAccountLimits,
  suggestedCredentialEnvs,
  suggestedCredentialEnvForSlot,
  suggestedProviderQuotas,
  type CredentialedResearchProviderKey
} from "@/lib/research/provider-keys";
import {
  BarChart3,
  Building2,
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UserRoundCog
} from "lucide-react";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Request failed.");
  return payload;
}

type OrganizationProfile = {
  id: string;
  revision: number;
  status: "draft" | "approved" | "superseded";
  companyName: string;
  description: string;
  services: string[];
  industries: string[];
  geographies: string[];
  idealClients: string[];
  clientProblems: string[];
  valuePropositions: string[];
  differentiators: string[];
  engagementModels: string[];
  qualificationCriteria: string[];
  exclusions: string[];
  terminology: Record<string, string>;
  publicContacts: Array<{ label: string; value: string }>;
  forbiddenClaims: string[];
  sourceUrls: string[];
  approvedAt: string | null;
  updatedAt: string;
};

const profileListFields = [
  ["services", "Services"],
  ["industries", "Industries"],
  ["geographies", "Geographies served"],
  ["idealClients", "Ideal clients"],
  ["clientProblems", "Client problems"],
  ["valuePropositions", "Value propositions"],
  ["differentiators", "Differentiators"],
  ["engagementModels", "Engagement models"],
  ["qualificationCriteria", "Qualification criteria"],
  ["exclusions", "Out of scope / exclusions"],
  ["forbiddenClaims", "Claims external agents must not make"],
  ["sourceUrls", "Public source URLs"]
] as const;

/** Admin-only editor for the official, externally shareable company context. */
export function OrganizationProfileSettings({ onError }: { onError: (message: string) => void }) {
  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [active, setActive] = useState<OrganizationProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [terminology, setTerminology] = useState("");
  const [contacts, setContacts] = useState("");
  const load = useCallback(async () => {
    const payload = await request<{ data: { active: OrganizationProfile | null; draft: OrganizationProfile | null } }>(
      "/api/v1/admin/organization-profile"
    );
    setActive(payload.data.active);
    setProfile(payload.data.draft);
    setTerminology(formatPairs(payload.data.draft?.terminology ?? {}));
    setContacts((payload.data.draft?.publicContacts ?? []).map((item) => `${item.label}: ${item.value}`).join("\n"));
  }, []);
  useEffect(() => { load().catch((error: Error) => onError(error.message)); }, [load, onError]);

  async function startDraft() {
    setBusy(true);
    try {
      await request("/api/v1/admin/organization-profile", { method: "POST" });
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Profile draft could not be created.");
    } finally { setBusy(false); }
  }

  async function persistProfile() {
    if (!profile) return;
    const next = await request<{ data: OrganizationProfile }>(`/api/v1/admin/organization-profile/${profile.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        companyName: profile.companyName,
        description: profile.description,
        services: profile.services,
        industries: profile.industries,
        geographies: profile.geographies,
        idealClients: profile.idealClients,
        clientProblems: profile.clientProblems,
        valuePropositions: profile.valuePropositions,
        differentiators: profile.differentiators,
        engagementModels: profile.engagementModels,
        qualificationCriteria: profile.qualificationCriteria,
        exclusions: profile.exclusions,
        terminology: parsePairRecord(terminology),
        publicContacts: parseContactPairs(contacts),
        forbiddenClaims: profile.forbiddenClaims,
        sourceUrls: profile.sourceUrls
      })
    });
    setProfile(next.data);
  }

  async function save() {
    setBusy(true);
    try {
      await persistProfile();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Company profile could not be saved.");
    } finally { setBusy(false); }
  }

  async function approve() {
    if (!profile || !window.confirm("Approve this version as the official MTI context? External MCP clients with organization:read will immediately use it.")) return;
    setBusy(true);
    try {
      await persistProfile();
      await request(`/api/v1/admin/organization-profile/${profile.id}/approve`, { method: "POST" });
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Company profile could not be approved.");
    } finally { setBusy(false); }
  }

  return (
    <section className="surface settings-wide">
      <div className="surface-header">
        <div>
          <h2><Building2 size={16} /> MTI Company Profile</h2>
          <span>Official context for Business OS and external MCP assistants</span>
        </div>
        {active && <span className="pill good"><CheckCircle2 size={13} /> Approved v{active.revision}</span>}
      </div>
      {!profile ? (
        <div className="settings-form">
          <p>{active ? `Version ${active.revision} is active. Create a draft to propose changes without affecting MCP clients.` : "No approved company profile exists. MCP clients will not infer MTI services until an admin approves one."}</p>
          <button className="primary" disabled={busy} onClick={() => void startDraft()}><Plus size={14} /> {active ? "Create new version" : "Create company profile"}</button>
        </div>
      ) : (
        <div className="settings-form organization-profile-form">
          <div className="settings-inline-note">Editing draft v{profile.revision}. Saving does not publish it.</div>
          <label>Company name<input value={profile.companyName} onChange={(event) => setProfile({ ...profile, companyName: event.target.value })} /></label>
          <label>Company description<textarea rows={5} value={profile.description} onChange={(event) => setProfile({ ...profile, description: event.target.value })} /></label>
          <div className="organization-profile-fields">
            {profileListFields.map(([field, label]) => (
              <label key={field}>{label}<textarea rows={4} placeholder="One item per line" value={profile[field].join("\n")} onChange={(event) => setProfile({ ...profile, [field]: lines(event.target.value) })} /></label>
            ))}
            <label>Terminology<textarea rows={4} placeholder="Term: approved meaning" value={terminology} onChange={(event) => setTerminology(event.target.value)} /></label>
            <label>Public contacts<textarea rows={4} placeholder="Email: hello@example.com" value={contacts} onChange={(event) => setContacts(event.target.value)} /></label>
          </div>
          <div className="settings-actions">
            <button className="secondary" disabled={busy || !profile.companyName.trim()} onClick={() => void save()}><Save size={14} /> Save draft</button>
            <button className="primary" disabled={busy || !profile.companyName.trim()} onClick={() => void approve()}><CheckCircle2 size={14} /> Save and approve</button>
          </div>
        </div>
      )}
    </section>
  );
}

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function formatPairs(value: Record<string, string>) {
  return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join("\n");
}

function parsedPairs(value: string) {
  return lines(value).map((line) => {
    const separator = line.indexOf(":");
    return separator < 1 ? [line, ""] as const : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const;
  }).filter(([, item]) => item);
}

function parsePairRecord(value: string): Record<string, string> {
  return Object.fromEntries(parsedPairs(value));
}

function parseContactPairs(value: string): Array<{ label: string; value: string }> {
  return parsedPairs(value).map(([label, item]) => ({ label, value: item }));
}

const externalScopes = [
  "organization:read", "projects:read", "companies:read", "documents:read", "evidence:read",
  "projects:draft", "research:execute", "reports:create"
] as const;

type ExternalCredential = {
  id: string;
  label: string;
  clientName: string;
  publicPrefix: string;
  scopes: string[];
  accessMode: "selected_projects" | "organization";
  status: string;
  projectIds: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
};

type McpMetrics = {
  totals: {
    calls: number; completed: number; failures: number; failureRate: number;
    averageLatencyMs: number; p95LatencyMs: number; truncatedResponses: number; modelCostMicros: number;
  };
};

export function ExternalMcpSettings({ onError }: { onError: (message: string) => void }) {
  const [credentials, setCredentials] = useState<ExternalCredential[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [metrics, setMetrics] = useState<McpMetrics | null>(null);
  const [label, setLabel] = useState("");
  const [clientName, setClientName] = useState("Codex");
  const [scopes, setScopes] = useState<string[]>(["projects:read", "companies:read", "documents:read", "evidence:read"]);
  const [accessMode, setAccessMode] = useState<"selected_projects" | "organization">("selected_projects");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [credentialPayload, projectPayload, metricPayload] = await Promise.all([
      request<{ data: ExternalCredential[] }>("/api/v1/admin/mcp-credentials"),
      request<{ data: Array<{ id: string; name: string }> }>("/api/v1/projects"),
      request<{ data: McpMetrics }>("/api/v1/admin/mcp-metrics?days=30")
    ]);
    setCredentials(credentialPayload.data);
    setProjects(projectPayload.data);
    setMetrics(metricPayload.data);
  }, []);
  useEffect(() => { load().catch((error: Error) => onError(error.message)); }, [load, onError]);

  async function createCredential() {
    if (accessMode === "organization" && !window.confirm("Create a credential that can access every current and future project in this organization? Selected-project access is safer.")) return;
    setBusy(true);
    try {
      const days = Number(expiresInDays);
      const payload = await request<{ data: { credential: ExternalCredential; token: string } }>("/api/v1/admin/mcp-credentials", {
        method: "POST",
        body: JSON.stringify({
          label,
          clientName,
          scopes,
          accessMode,
          projectIds: accessMode === "selected_projects" ? projectIds : [],
          expiresAt: Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null
        })
      });
      setToken(payload.data.token);
      setLabel("");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "External MCP credential could not be created.");
    } finally { setBusy(false); }
  }

  async function rotateCredential(credentialId: string) {
    if (!window.confirm("Rotate this credential? The old token will stop working immediately.")) return;
    try {
      const payload = await request<{ data: { token: string } }>(`/api/v1/admin/mcp-credentials/${credentialId}/rotate`, { method: "POST" });
      setToken(payload.data.token);
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Credential could not be rotated."); }
  }

  async function revokeCredential(credentialId: string) {
    if (!window.confirm("Revoke this credential immediately?")) return;
    try {
      await request(`/api/v1/admin/mcp-credentials/${credentialId}`, { method: "DELETE" });
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Credential could not be revoked."); }
  }

  return (
    <section className="surface settings-wide">
      <div className="surface-header"><div><h2><KeyRound size={16} /> External MCP access</h2><span>Credentials for Codex, Claude, Gemini, and other MCP clients</span></div></div>
      {metrics && <div className="metric-strip">
        <div><span>Calls · 30d</span><strong>{metrics.totals.calls}</strong></div>
        <div><span>Failures</span><strong>{metrics.totals.failures}</strong></div>
        <div><span>P95 latency</span><strong>{metrics.totals.p95LatencyMs} ms</strong></div>
        <div><span>Truncated</span><strong>{metrics.totals.truncatedResponses}</strong></div>
        <div><span>Model cost</span><strong>${(metrics.totals.modelCostMicros / 1_000_000).toFixed(4)}</strong></div>
      </div>}
      {token && <div className="credential-token-reveal">
        <strong>Copy this token now. It will not be shown again.</strong>
        <code>{token}</code>
        <button className="secondary" onClick={() => void navigator.clipboard.writeText(token)}><Copy size={13} /> Copy token</button>
        <button className="secondary" onClick={() => setToken(null)}>Dismiss</button>
      </div>}
      <div className="settings-form">
        <div className="admin-create-row">
          <input placeholder="Credential label" value={label} onChange={(event) => setLabel(event.target.value)} />
          <select value={clientName} onChange={(event) => setClientName(event.target.value)}><option>Codex</option><option>Claude</option><option>Gemini</option><option>Other</option></select>
          <select value={accessMode} onChange={(event) => setAccessMode(event.target.value as typeof accessMode)}><option value="selected_projects">Selected projects</option><option value="organization">All organization projects</option></select>
          <input type="number" min="1" max="365" aria-label="Expires in days" value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} />
        </div>
        <div className="mcp-scope-grid">{externalScopes.map((scope) => <label key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={(event) => setScopes((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope))} /> {scope}</label>)}</div>
        {accessMode === "selected_projects" && <div className="mcp-project-grid">{projects.map((project) => <label key={project.id}><input type="checkbox" checked={projectIds.includes(project.id)} onChange={(event) => setProjectIds((current) => event.target.checked ? [...current, project.id] : current.filter((item) => item !== project.id))} /> {project.name}</label>)}</div>}
        <button className="primary" disabled={busy || !label.trim() || !scopes.length || (accessMode === "selected_projects" && !projectIds.length)} onClick={() => void createCredential()}><Plus size={14} /> Create credential</button>
      </div>
      <div className="admin-table">{credentials.map((credential) => <div className="external-credential-row" key={credential.id}>
        <div><strong>{credential.label}</strong><span>{credential.clientName} · …{credential.publicPrefix} · {credential.accessMode.replace("_", " ")}</span></div>
        <span className={credential.status === "active" ? "pill good" : "pill warn"}>{credential.status}</span>
        <span>{credential.scopes.join(", ")}</span>
        <span>{credential.lastUsedAt ? `Used ${new Date(credential.lastUsedAt).toLocaleString()}` : "Never used"}</span>
        {credential.status === "active" && <><button className="secondary" onClick={() => void rotateCredential(credential.id)}><RotateCcw size={13} /> Rotate</button><button className="secondary danger" onClick={() => void revokeCredential(credential.id)}><Trash2 size={13} /> Revoke</button></>}
      </div>)}</div>
    </section>
  );
}

export function PasswordSettings({ onError }: { onError: (message: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (newPassword !== confirmation) {
      onError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await request("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      window.location.assign("/login");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Password could not be changed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface settings-wide">
      <div className="surface-header"><h2><KeyRound size={16} /> Password</h2></div>
      <div className="settings-form">
        <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {busy && <Loader2 size={14} className="spin" />} Change password
        </button>
      </div>
    </section>
  );
}

type OrganizationUser = {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: "admin" | "member";
  status: "active" | "disabled";
  lastLoginAt: string | null;
  emailNotificationsEnabled: boolean;
};

export function AdminUsersSettings({ onError }: { onError: (message: string) => void }) {
  const [users, setUsers] = useState<OrganizationUser[]>([]);
  const [history, setHistory] = useState<Array<{ id: string; username: string | null; event: string; success: boolean; createdAt: string }>>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => request<{ data: { users: OrganizationUser[]; history: typeof history } }>("/api/v1/admin/users")
    .then((payload) => {
      setUsers(payload.data.users);
      setHistory(payload.data.history);
      setEmails(Object.fromEntries(payload.data.users.map((user) => [user.id, user.email ?? user.username])));
    }), []);
  useEffect(() => { load().catch((error: Error) => onError(error.message)); }, [load, onError]);
  async function create() {
    if (password !== passwordConfirmation) {
      onError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await request<{ data: { user: OrganizationUser } }>("/api/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({ name, email, password, role })
      });
      setName("");
      setEmail("");
      setPassword("");
      setPasswordConfirmation("");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "User could not be created.");
    } finally {
      setBusy(false);
    }
  }
  async function update(user: OrganizationUser, changes: Partial<Pick<OrganizationUser, "name" | "email" | "role" | "status" | "emailNotificationsEnabled">>) {
    try {
      await request(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH", body: JSON.stringify(changes)
      });
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "User could not be updated.");
    }
  }
  async function reset(user: OrganizationUser) {
    const nextPassword = passwords[user.id] ?? "";
    try {
      await request(`/api/v1/admin/users/${user.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: nextPassword })
      });
      setPasswords((current) => ({ ...current, [user.id]: "" }));
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Password could not be reset.");
    }
  }
  return (
    <section className="surface settings-wide">
      <div className="surface-header"><div><h2><UserRoundCog size={16} /> Users</h2><span>{users.length} company accounts</span></div></div>
      <div className="admin-create-row">
        <input placeholder="Full name" value={name} onChange={(event) => setName(event.target.value)} />
        <input type="email" placeholder="Email address" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input type="password" placeholder="Initial password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <input type="password" placeholder="Confirm password" autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} />
        <select value={role} onChange={(event) => setRole(event.target.value as "admin" | "member")}><option value="member">Member</option><option value="admin">Admin</option></select>
        <button className="primary" disabled={busy || !name.trim() || !email.includes("@") || !password || password !== passwordConfirmation} onClick={() => void create()}><Plus size={14} /> Create user</button>
      </div>
      <div className="admin-table">
        {users.map((user) => (
          <div className="admin-user-row" key={user.id}>
            <div><strong>{user.name}</strong><span>{user.email ?? user.username} · {user.lastLoginAt ? `last login ${new Date(user.lastLoginAt).toLocaleString()}` : "never signed in"}</span></div>
            {user.id !== "00000000-0000-4000-8000-000000000002" && <><input type="email" value={emails[user.id] ?? user.email ?? user.username} onChange={(event) => setEmails((current) => ({ ...current, [user.id]: event.target.value }))} /><button className="secondary" disabled={(emails[user.id] ?? user.email ?? user.username) === (user.email ?? user.username)} onClick={() => void update(user, { email: emails[user.id] })}>Save email</button></>}
            <select value={user.role} onChange={(event) => void update(user, { role: event.target.value as "admin" | "member" })}><option value="member">Member</option><option value="admin">Admin</option></select>
            <span className={user.status === "active" ? "pill good" : "pill warn"}>{user.status}</span>
            <label><input type="checkbox" checked={user.emailNotificationsEnabled} onChange={(event) => void update(user, { emailNotificationsEnabled: event.target.checked })} /> Email notifications</label>
            {user.id !== "00000000-0000-4000-8000-000000000002" && <><input type="password" autoComplete="new-password" placeholder="Set new password" value={passwords[user.id] ?? ""} onChange={(event) => setPasswords((current) => ({ ...current, [user.id]: event.target.value }))} /><button className="secondary" disabled={!passwords[user.id]} onClick={() => void reset(user)}><RefreshCw size={13} /> Set password</button></>}
            <button className="secondary" onClick={() => void update(user, { status: user.status === "active" ? "disabled" : "active" })}>{user.status === "active" ? "Disable" : "Enable"}</button>
          </div>
        ))}
      </div>
      <details className="auth-history"><summary>Login history</summary>{history.slice(0, 20).map((event) => <div key={event.id}><span>{event.username ?? "Unknown"}</span><span>{event.event}</span><span>{event.success ? "Success" : "Failed"}</span><time>{new Date(event.createdAt).toLocaleString()}</time></div>)}</details>
    </section>
  );
}

type AnalyticsPayload = {
  totals: {
    requests: number; successes: number; failures: number; fallbacks: number;
    retries: number; inputTokens: number; outputTokens: number; costMicros: number;
  };
  rows: Array<{
    projectName: string | null; userName: string | null; agentType: string | null;
    route: string; provider: string | null; model: string | null; requests: number;
    successes: number; failures: number; fallbacks: number; retries: number;
    inputTokens: number; outputTokens: number; averageLatencyMs: number; costMicros: number;
  }>;
  quotas: Array<{
    id: string; provider: string; route: string | null; period: string;
    allowance: number; timezone: string; active: boolean;
    state: { used: number; remaining: number; resetAt: string };
  }>;
  approvals: Array<{
    id: string; route: string; proposedModel: string; status: string;
    maximumCostMicros: number; reason: string;
  }>;
  providerUsage: Array<{ provider: string; route: string; source: string; requests: number }>;
  providerReported: { tavily: { configured: boolean; available: boolean; data?: Record<string, unknown> } };
};

type ProviderAccount = {
  id: string; provider: CredentialedResearchProviderKey; label: string; ownerLabel: string;
  credentialEnv: string; priority: number; allowance: number | null; status: string;
  resetAt: string | null; cooldownUntil: string | null; credentialConfigured: boolean;
  authorizationConfirmed: boolean; lastError: string | null;
};

export function AiAnalyticsSettings({ onError }: { onError: (message: string) => void }) {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [accountProvider, setAccountProvider] = useState<CredentialedResearchProviderKey>("tavily");
  const [accountLabel, setAccountLabel] = useState("");
  const [accountOwner, setAccountOwner] = useState("");
  const [accountEnv, setAccountEnv] = useState(suggestedCredentialEnvs.tavily);
  const [days, setDays] = useState("30");
  const [provider, setProvider] = useState("");
  const [route, setRoute] = useState("");
  const [period, setPeriod] = useState<"daily" | "monthly">("monthly");
  const [allowance, setAllowance] = useState("");
  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(days) * 86_400_000);
    return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  }, [days]);
  const load = useCallback(async () => {
    const [analytics, providerAccounts] = await Promise.all([
      request<{ data: AnalyticsPayload }>(`/api/v1/admin/ai-analytics?${range}`),
      request<{ data: ProviderAccount[] }>("/api/v1/admin/provider-accounts")
    ]);
    setData(analytics.data);
    setAccounts(providerAccounts.data);
  }, [range]);
  useEffect(() => { load().catch((error: Error) => onError(error.message)); }, [load, onError]);
  async function addQuota() {
    try {
      await request("/api/v1/admin/provider-quotas", {
        method: "POST",
        body: JSON.stringify({
          provider,
          route: route || null,
          period,
          allowance: Number(allowance),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      });
      setAllowance("");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Quota could not be saved.");
    }
  }
  async function addProviderAccount() {
    try {
      const quota = suggestedProviderQuotas[accountProvider];
      await request("/api/v1/admin/provider-accounts", {
        method: "POST",
        body: JSON.stringify({
          provider: accountProvider, label: accountLabel, ownerLabel: accountOwner,
          credentialEnv: accountEnv, priority: accounts.filter((item) => item.provider === accountProvider).length + 1,
          allowance: quota.allowance, quotaPeriod: quota.quotaPeriod, authorizationConfirmed: true
        })
      });
      const nextSlot = accounts.filter((item) => item.provider === accountProvider).length + 1;
      setAccountLabel(""); setAccountOwner(""); setAccountEnv(suggestedCredentialEnvForSlot(accountProvider, nextSlot));
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Provider account could not be saved.");
    }
  }
  async function toggleProviderAccount(account: ProviderAccount) {
    try {
      await request("/api/v1/admin/provider-accounts", {
        method: "PATCH", body: JSON.stringify({ id: account.id, status: account.status === "active" ? "disabled" : "active" })
      });
      await load();
    } catch (error) { onError(error instanceof Error ? error.message : "Provider account could not be updated."); }
  }
  const breakdowns = useMemo(() => {
    const group = (key: "projectName" | "model" | "agentType" | "provider") => Object.entries((data?.rows ?? []).reduce<Record<string, number>>((totals, row) => {
      const label = row[key] ?? "Unassigned"; totals[label] = (totals[label] ?? 0) + row.requests; return totals;
    }, {})).sort((a, b) => b[1] - a[1]);
    return { projects: group("projectName"), models: group("model"), agents: group("agentType"), providers: group("provider") };
  }, [data]);
  const accountCount = accounts.filter((item) => item.provider === accountProvider).length;
  const providerGroups: Array<{ title: string; keys: CredentialedResearchProviderKey[] }> = [
    { title: "Search & website research", keys: ["tavily", "firecrawl"] },
    { title: "Korean company data", keys: ["opendart", "korean_public_data", "kosis"] },
    { title: "U.S. and market data", keys: ["sam_gov", "us_census", "fred"] }
  ];
  return (
    <section className="surface settings-wide analytics-surface">
      <div className="surface-header">
        <div><h2><BarChart3 size={16} /> AI Analytics</h2><span>Observed provider usage and estimated spend</span></div>
        <div className="surface-actions">
          <select value={days} onChange={(event) => setDays(event.target.value)}><option value="1">Today</option><option value="30">30 days</option><option value="90">90 days</option><option value="3650">Lifetime</option></select>
          <a className="secondary button-link" href={`/api/v1/admin/ai-analytics?${range}&format=csv`}><Download size={14} /> CSV</a>
        </div>
      </div>
      {!data ? <div className="empty-inline">Loading AI usage…</div> : (
        <>
          <div className="analytics-kpis">
            <Metric label="Requests" value={data.totals.requests.toLocaleString()} />
            <Metric label="Success rate" value={`${data.totals.requests ? Math.round((data.totals.successes / data.totals.requests) * 100) : 0}%`} />
            <Metric label="Tokens" value={(data.totals.inputTokens + data.totals.outputTokens).toLocaleString()} />
            <Metric label="Fallbacks" value={data.totals.fallbacks.toLocaleString()} />
            <Metric label="Failures" value={data.totals.failures.toLocaleString()} />
            <Metric label="Estimated cost" value={`$${(data.totals.costMicros / 1_000_000).toFixed(4)}`} />
          </div>
          <div className="analytics-breakdowns">
            <Breakdown title="Projects" rows={breakdowns.projects} />
            <Breakdown title="Models" rows={breakdowns.models} />
            <Breakdown title="Agents" rows={breakdowns.agents} />
            <Breakdown title="Providers / API keys" rows={breakdowns.providers} />
          </div>
          <div className="analytics-table">
            <div className="analytics-row analytics-head"><span>Project / user</span><span>Route / model</span><span>Requests</span><span>Tokens</span><span>Latency</span><span>Cost</span></div>
            {data.rows.map((row, index) => (
              <div className="analytics-row" key={`${row.route}-${row.model}-${index}`}>
                <span><strong>{row.projectName ?? "Organization"}</strong><small>{row.userName ?? "System"} · {row.agentType ?? "agent"}</small></span>
                <span><strong>{row.route}</strong><small>{row.provider ?? "unknown"} · {row.model ?? "unknown"}</small></span>
                <span>{row.requests}</span>
                <span>{(row.inputTokens + row.outputTokens).toLocaleString()}</span>
                <span>{row.averageLatencyMs} ms</span>
                <span>${(Number(row.costMicros) / 1_000_000).toFixed(4)}</span>
              </div>
            ))}
          </div>
          <div className="quota-section">
            <div className="surface-header"><div><h3>Research API accounts</h3><span>Three rotating personal-account slots are available for both Tavily and Firecrawl. Secret values stay in deployment environment variables.</span></div></div>
            <div className="provider-account-create">
              <label><span>Provider</span>
              <select value={accountProvider} onChange={(event) => {
                const next = event.target.value as CredentialedResearchProviderKey;
                setAccountProvider(next);
                const nextSlot = accounts.filter((item) => item.provider === next).length;
                setAccountEnv(suggestedCredentialEnvForSlot(next, nextSlot));
              }}>{credentialedResearchProviderKeys.map((key) => <option key={key} value={key}>{credentialedResearchProviderLabels[key]}</option>)}</select></label>
              <label><span>Account label</span><input placeholder={`Personal account ${accountCount + 1}`} value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} /></label>
              <label><span>Owner</span><input placeholder="Account owner" value={accountOwner} onChange={(event) => setAccountOwner(event.target.value)} /></label>
              <label className="provider-secret-field"><span>Environment secret</span><input placeholder="Environment secret name" value={accountEnv} onChange={(event) => setAccountEnv(event.target.value.toUpperCase())} /></label>
              <div className="provider-add-action"><span>{accountCount} / {providerAccountLimits[accountProvider]} slots</span><button className="secondary" disabled={accountCount >= providerAccountLimits[accountProvider] || !accountLabel || !/^[A-Z][A-Z0-9_]{2,99}$/.test(accountEnv)} onClick={() => void addProviderAccount()}><Plus size={14} /> Add account</button></div>
            </div>
            <div className="provider-account-groups">{providerGroups.map((group) => <section key={group.title} className="provider-account-group"><header><h4>{group.title}</h4><span>{accounts.filter((item) => group.keys.includes(item.provider)).length} connected</span></header>{group.keys.map((key) => {
              const providerAccounts = accounts.filter((item) => item.provider === key);
              return <div className="provider-account-provider" key={key}><div className="provider-account-provider-head"><strong>{credentialedResearchProviderLabels[key]}</strong><span>{providerAccounts.length} / {providerAccountLimits[key]} slots</span></div>{providerAccounts.length === 0 ? <div className="provider-account-empty">No account registered</div> : providerAccounts.map((account) => <div className="provider-account-row" key={account.id}>
                <div><strong>{account.label}</strong><span>{account.ownerLabel || "Personal account"} · priority {account.priority}</span></div>
                <code>{account.credentialEnv}</code>
                <span className={`pill ${account.credentialConfigured ? "good" : "warn"}`}>{account.credentialConfigured ? "Secret connected" : "Secret missing"}</span>
                <span>{account.authorizationConfirmed ? "Authorized" : "Authorization required"}{account.cooldownUntil ? ` · cooldown until ${new Date(account.cooldownUntil).toLocaleString()}` : ""}</span>
                <button className="secondary" onClick={() => void toggleProviderAccount(account)}>{account.status === "active" ? "Disable" : "Enable"}</button>
              </div>)}</div>;
            })}</section>)}</div>
            {accounts.length === 0 && <div className="empty-inline">No provider accounts registered. Legacy environment keys remain available until accounts are added.</div>}
          </div>
          <div className="quota-section">
            <div className="surface-header"><h3>Free API quotas</h3></div>
            <div className="admin-create-row quota-create">
              <input placeholder="Provider (e.g. tavily)" value={provider} onChange={(event) => setProvider(event.target.value)} />
              <input placeholder="Route (optional)" value={route} onChange={(event) => setRoute(event.target.value)} />
              <select value={period} onChange={(event) => setPeriod(event.target.value as "daily" | "monthly")}><option value="daily">Daily</option><option value="monthly">Monthly</option></select>
              <input type="number" min="1" placeholder="Allowance" value={allowance} onChange={(event) => setAllowance(event.target.value)} />
              <button className="secondary" disabled={!provider || !allowance} onClick={() => void addQuota()}><Plus size={14} /> Add quota</button>
            </div>
            {data.quotas.map((quota) => {
              const percent = Math.min(100, (quota.state.used / quota.allowance) * 100);
              return <div className="quota-row" key={quota.id}><div><strong>{quota.provider}</strong><span>{quota.route === "*" ? "All routes" : quota.route} · {quota.period}</span></div><div className="quota-meter"><span style={{ width: `${percent}%` }} /></div><strong>{quota.state.used.toLocaleString()} / {quota.allowance.toLocaleString()}</strong><span>Resets {new Date(quota.state.resetAt).toLocaleString()}</span></div>;
            })}
            <div className="quota-row"><div><strong>Tavily provider report</strong><span>Live account endpoint · credentials never displayed</span></div><div /><strong>{data.providerReported.tavily.available ? "Connected" : data.providerReported.tavily.configured ? "Unavailable" : "Key missing"}</strong><span>{data.providerReported.tavily.available ? JSON.stringify(data.providerReported.tavily.data) : "Local observed counter remains active"}</span></div>
            {data.providerUsage.map((usage) => <div className="quota-row" key={`${usage.provider}-${usage.route}-${usage.source}`}><div><strong>{usage.provider}</strong><span>{usage.route} · {usage.source}</span></div><div /><strong>{usage.requests.toLocaleString()} requests</strong><span>Selected period</span></div>)}
          </div>
          {data.approvals.length > 0 && <div className="quota-section"><div className="surface-header"><h3><ShieldCheck size={15} /> Premium approvals</h3></div>{data.approvals.map((approval) => <div className="approval-row" key={approval.id}><div><strong>{approval.route}</strong><span>{approval.proposedModel} · up to ${(approval.maximumCostMicros / 1_000_000).toFixed(2)}</span><small>{approval.reason}</small></div><span className={`pill ${approval.status === "pending" ? "warn" : "good"}`}>{approval.status}</span>{approval.status === "pending" && <><button className="primary" onClick={() => void decide(approval.id, "approved", load, onError)}>Approve</button><button className="secondary" onClick={() => void decide(approval.id, "rejected", load, onError)}>Reject</button></>}</div>)}</div>}
        </>
      )}
    </section>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return <section className="analytics-breakdown"><h3>{title}</h3>{rows.slice(0, 6).map(([label, count]) => <div key={label}><span title={label}>{label}</span><strong>{count.toLocaleString()}</strong></div>)}{rows.length === 0 && <span className="empty-inline">No activity yet</span>}</section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="analytics-metric"><span>{label}</span><strong>{value}</strong></div>;
}

async function decide(id: string, decision: "approved" | "rejected", load: () => Promise<void>, onError: (message: string) => void) {
  try {
    await request(`/api/v1/admin/premium-approvals/${id}/decision`, {
      method: "POST", body: JSON.stringify({ decision, note: "" })
    });
    await load();
  } catch (error) {
    onError(error instanceof Error ? error.message : "Decision failed.");
  }
}
