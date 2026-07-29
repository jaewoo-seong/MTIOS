"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
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
        <button className="primary" disabled={busy || newPassword.length < 12} onClick={() => void save()}>
          {busy && <Loader2 size={14} className="spin" />} Change password
        </button>
      </div>
    </section>
  );
}

type OrganizationUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "disabled";
  forcePasswordChange: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
};

export function AdminUsersSettings({ onError }: { onError: (message: string) => void }) {
  const [users, setUsers] = useState<OrganizationUser[]>([]);
  const [history, setHistory] = useState<Array<{ id: string; email: string | null; event: string; success: boolean; createdAt: string }>>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [temporary, setTemporary] = useState<{ email: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => request<{ data: { users: OrganizationUser[]; history: typeof history } }>("/api/v1/admin/users")
    .then((payload) => {
      setUsers(payload.data.users);
      setHistory(payload.data.history);
    }), []);
  useEffect(() => { load().catch((error: Error) => onError(error.message)); }, [load, onError]);
  async function create() {
    setBusy(true);
    try {
      const payload = await request<{ data: { user: OrganizationUser; temporaryPassword: string } }>("/api/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({ name, email, role })
      });
      setTemporary({ email: payload.data.user.email, password: payload.data.temporaryPassword });
      setName("");
      setEmail("");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "User could not be created.");
    } finally {
      setBusy(false);
    }
  }
  async function update(user: OrganizationUser, changes: Partial<Pick<OrganizationUser, "role" | "status">>) {
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
    try {
      const payload = await request<{ data: { temporaryPassword: string } }>(`/api/v1/admin/users/${user.id}/reset-password`, { method: "POST" });
      setTemporary({ email: user.email, password: payload.data.temporaryPassword });
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
        <input type="email" placeholder="Company email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <select value={role} onChange={(event) => setRole(event.target.value as "admin" | "member")}><option value="member">Member</option><option value="admin">Admin</option></select>
        <button className="primary" disabled={busy || !name || !email} onClick={() => void create()}><Plus size={14} /> Create user</button>
      </div>
      {temporary && (
        <div className="credential-once">
          <div><strong>Temporary password for {temporary.email}</strong><span>Shown once. Expires in 72 hours.</span></div>
          <code>{temporary.password}</code>
          <button className="icon-button" title="Copy temporary password" onClick={() => void navigator.clipboard.writeText(temporary.password)}><Copy size={15} /></button>
          <button className="secondary" onClick={() => setTemporary(null)}>Done</button>
        </div>
      )}
      <div className="admin-table">
        {users.map((user) => (
          <div className="admin-user-row" key={user.id}>
            <div><strong>{user.name}</strong><span>{user.email} · {user.lastLoginAt ? `last login ${new Date(user.lastLoginAt).toLocaleString()}` : "never signed in"}</span></div>
            <select value={user.role} onChange={(event) => void update(user, { role: event.target.value as "admin" | "member" })}><option value="member">Member</option><option value="admin">Admin</option></select>
            <span className={user.status === "active" ? "pill good" : "pill warn"}>{user.status}</span>
            <button className="secondary" onClick={() => void reset(user)}><RefreshCw size={13} /> Reset password</button>
            <button className="secondary" onClick={() => void update(user, { status: user.status === "active" ? "disabled" : "active" })}>{user.status === "active" ? "Disable" : "Enable"}</button>
          </div>
        ))}
      </div>
      <details className="auth-history"><summary>Login history</summary>{history.slice(0, 20).map((event) => <div key={event.id}><span>{event.email ?? "Unknown"}</span><span>{event.event}</span><span>{event.success ? "Success" : "Failed"}</span><time>{new Date(event.createdAt).toLocaleString()}</time></div>)}</details>
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
};

export function AiAnalyticsSettings({ onError }: { onError: (message: string) => void }) {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
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
  const load = useCallback(() => request<{ data: AnalyticsPayload }>(`/api/v1/admin/ai-analytics?${range}`)
    .then((payload) => setData(payload.data)), [range]);
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
            <Metric label="Tokens" value={(data.totals.inputTokens + data.totals.outputTokens).toLocaleString()} />
            <Metric label="Fallbacks" value={data.totals.fallbacks.toLocaleString()} />
            <Metric label="Failures" value={data.totals.failures.toLocaleString()} />
            <Metric label="Estimated cost" value={`$${(data.totals.costMicros / 1_000_000).toFixed(4)}`} />
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
            {data.providerUsage.map((usage) => <div className="quota-row" key={`${usage.provider}-${usage.route}-${usage.source}`}><div><strong>{usage.provider}</strong><span>{usage.route} · {usage.source}</span></div><div /><strong>{usage.requests.toLocaleString()} requests</strong><span>Selected period</span></div>)}
          </div>
          {data.approvals.length > 0 && <div className="quota-section"><div className="surface-header"><h3><ShieldCheck size={15} /> Premium approvals</h3></div>{data.approvals.map((approval) => <div className="approval-row" key={approval.id}><div><strong>{approval.route}</strong><span>{approval.proposedModel} · up to ${(approval.maximumCostMicros / 1_000_000).toFixed(2)}</span><small>{approval.reason}</small></div><span className={`pill ${approval.status === "pending" ? "warn" : "good"}`}>{approval.status}</span>{approval.status === "pending" && <><button className="primary" onClick={() => void decide(approval.id, "approved", load, onError)}>Approve</button><button className="secondary" onClick={() => void decide(approval.id, "rejected", load, onError)}>Reject</button></>}</div>)}</div>}
        </>
      )}
    </section>
  );
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
