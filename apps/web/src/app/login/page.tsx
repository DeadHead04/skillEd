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
      <section className="login-aside">
        <div className="brand">
          <span className="brand-mark">S</span>SkillEd
        </div>
        <div>
          <h2>A Skill only works when the evidence says so.</h2>
          <p>
            SkillEd runs your Skill against cases built from your own task
            material, then reports what actually happened — including the
            failures a passing score would have hidden.
          </p>
          <div className="login-legend">
            <div>
              <b>✓ Pass</b>Every required dimension held.
            </div>
            <div>
              <b>▲ Partial</b>The fix landed but something else broke.
            </div>
            <div>
              <b>✕ Fail</b>The Skill got the task wrong.
            </div>
            <div>
              <b>○ Error</b>No trustworthy evidence — never a Skill failure.
            </div>
          </div>
        </div>
      </section>

      <section className="login-main">
        <div className="login-panel">
          <h1>Sign in</h1>
          <p className="page-lede">
            Use your own account. Codex credentials stay inside the worker and
            are never handled by the browser.
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
            Sessions last 24 hours. Five wrong attempts lock the login ID for 15
            minutes.
          </p>
        </div>
      </section>
    </main>
  );
}
