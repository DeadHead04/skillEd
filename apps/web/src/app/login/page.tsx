"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      const problem = await response.json();
      setError(problem.detail ?? "Sign in failed.");
      setBusy(false);
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.assign(next?.startsWith("/") ? next : "/skill");
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand login-brand">
          <span className="brand-mark">S</span>SkillEd
        </div>
        <div className="eyebrow">Private evaluation workbench</div>
        <h1 id="login-title">Sign in to inspect the evidence</h1>
        <p className="lede">
          One local administrator controls Skill packages, evaluations, and
          activation decisions. Codex credentials remain inside the worker.
        </p>
        <form onSubmit={submit} className="login-form">
          <div className="field">
            <label htmlFor="password">Administrator password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <button className="btn" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="login-note">
          Local access only · session expires after 24 hours
        </p>
      </section>
    </main>
  );
}
