"use client";
import { apiFetch, safeRedirect } from "../../lib/client-request";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function LoginPage() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [show, setShow] = useState(false);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setLoginId(query.get("loginId") ?? "");
    setChanged(query.has("passwordChanged"));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await apiFetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loginId, password }),
    });
    if (!response.ok) {
      const problem = await response.json();
      setError(
        problem.code === "NETWORK_UNAVAILABLE"
          ? "Could not reach SkillEd. Check your connection and try again."
          : (problem.detail ?? "Sign in failed."),
      );
      setBusy(false);
      return;
    }
    const result = await response.json();
    if (result.passwordChangeRequired) {
      window.location.assign("/account");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.assign(safeRedirect(next, window.location.origin));
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
          <p className="lede">
            Use your SkillEd login ID and password to open your shared
            workbench.
          </p>
          {changed && (
            <p className="success-box" role="status">
              Password updated. Sign in with your new password.
            </p>
          )}
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
              <div className="password-control">
                <input
                  id="password"
                  name="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="text-button"
                  aria-label={show ? "Hide password" : "Show password"}
                  aria-pressed={show}
                  onClick={() => setShow(!show)}
                >
                  {show ? "Hide" : "Show"}
                </button>
              </div>
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
          <p className="auth-links">
            <Link href="/signup">Create an account</Link>
            <Link href="/forgot-password">Forgot password?</Link>
          </p>
          <p className="login-note">
            Sessions last 24 hours. Five wrong attempts lock the login ID for 15
            minutes.
          </p>
        </div>
      </section>
    </main>
  );
}
