"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Password could not be changed.");
      window.location.assign("/login");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div>
        <span className="auth-brand">MTI Korea</span>
        <h1>Set your password</h1>
        <p>Use at least 12 characters with a letter and number.</p>
      </div>
      <label>Temporary password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoFocus /></label>
      <label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} required /></label>
      <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} required /></label>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="primary auth-submit" disabled={busy}>
        {busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
        Change password
      </button>
    </form>
  );
}
