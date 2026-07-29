"use client";

import { useState } from "react";
import { ArrowRight, Loader2, LockKeyhole } from "lucide-react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Login failed.");
      window.location.assign(payload.data.forcePasswordChange ? "/change-password" : "/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-mark"><LockKeyhole size={20} /></div>
      <div>
        <span className="auth-brand">MTI Korea</span>
        <h1>Business OS</h1>
        <p>Sign in with your company account.</p>
      </div>
      <label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="primary auth-submit" disabled={busy}>
        {busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}
        Sign in
      </button>
    </form>
  );
}
