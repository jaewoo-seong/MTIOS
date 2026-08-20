"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

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
        // The API key remains backwards compatible for the Railway operator;
        // normal users enter an email address here.
        body: JSON.stringify({ username: email, password })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Login failed.");
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-mark"><BrandLogo alt="" priority /></div>
      <div>
        <span className="auth-brand">MTI Korea</span>
        <h1>Business OS</h1>
        <p>Sign in with your company email. The break-glass operator account may still use its username.</p>
      </div>
      <label>Email<input type="text" inputMode="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="primary auth-submit" disabled={busy}>
        {busy ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}
        Sign in
      </button>
      {process.env.NEXT_PUBLIC_UI_AUDIT_MODE === "true" && (
        <button type="button" className="secondary auth-submit" onClick={() => window.location.assign("/")}>
          Enter development workspace
        </button>
      )}
      {process.env.NEXT_PUBLIC_UI_AUDIT_MODE === "true" && (
        <p className="auth-dev-note">Local fixture data only. Provider calls and production data are disabled.</p>
      )}
    </form>
  );
}
