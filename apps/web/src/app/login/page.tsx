"use client";

import { useState } from "react";

export default function LoginPage() {
  const [loginId, setLoginId] = useState("admin");
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
      body: JSON.stringify({ loginId, password }),
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
          Use your individual SkillEd account. Administrators manage access;
          Codex credentials remain isolated inside the worker.
        </p>
        <form onSubmit={submit} className="login-form">
          <div className="field">
            <label htmlFor="loginId">Login ID</label>
            <input
              id="loginId"
              name="loginId"
              type="text"
              autoComplete="username"
              required
              autoFocus
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
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
          Named local account · session expires after 24 hours
        </p>
      </section>
    </main>
  );
}
