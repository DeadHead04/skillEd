"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/client-request";
import { AuthShell } from "./auth-shell";
import { PasswordField } from "./password-field";

export function AccountEntry({ kind }: { kind: "signup" | "reset-password" }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [loginId, setLoginId] = useState("");
  useEffect(() => {
    setToken(
      new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "",
    );
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = Object.fromEntries(new FormData(form));
    if (input.password !== input.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const response = await apiFetch(`/api/v1/auth/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, token }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(
        result.code === "NETWORK_UNAVAILABLE"
          ? "We could not confirm the result. Try signing in if you submitted already, or retry when your connection returns."
          : (result.detail ?? "Please try again."),
      );
      return;
    }
    setLoginId(result.loginId ?? "");
    setComplete(true);
    form.reset();
    window.history.replaceState(null, "", window.location.pathname);
  }
  const signup = kind === "signup";
  return (
    <AuthShell
      title={
        complete
          ? signup
            ? "Your account is ready"
            : "Password updated"
          : signup
            ? "Create your account"
            : "Choose a new password"
      }
      description={
        complete
          ? signup
            ? "Sign in with the login ID and password you chose."
            : "All previous sessions have ended. Sign in with your new password."
          : signup
            ? "Use an invitation from your administrator to join this shared SkillEd installation."
            : "Use the single-use reset link from your administrator. Your saved work stays in place."
      }
    >
      {complete ? (
        <>
          <p role="status" className="success-box">
            {signup
              ? `Account created${loginId ? ` for @${loginId}` : ""}.`
              : "Your password was changed successfully."}
          </p>
          <Link
            className="btn auth-primary"
            href={`/login${loginId ? `?loginId=${encodeURIComponent(loginId)}` : "?passwordChanged=1"}`}
          >
            Continue to sign in
          </Link>
        </>
      ) : (
        <form className="login-form" onSubmit={submit}>
          {!token && (
            <p className="notice">
              {signup
                ? "Ask an administrator to open Users and create an invitation link. Open that link here, or paste its code below."
                : "Ask an administrator for a password reset link, or paste its code below."}
            </p>
          )}
          <details open={!token}>
            <summary>{signup ? "Invitation code" : "Reset code"}</summary>
            <div className="field">
              <label htmlFor="token">
                {signup ? "Invitation code" : "Reset code"}
              </label>
              <input
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value.trim())}
                autoComplete="off"
                required
                minLength={64}
                maxLength={64}
                spellCheck={false}
              />
            </div>
          </details>
          {signup && (
            <>
              <div className="field">
                <label htmlFor="displayName">Display name</label>
                <input
                  id="displayName"
                  name="displayName"
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="loginId">Login ID</label>
                <input
                  id="loginId"
                  name="loginId"
                  autoComplete="username"
                  minLength={3}
                  maxLength={40}
                  pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
                  required
                />
                <small>
                  3–40 letters, numbers, periods, underscores, or hyphens.
                  Sign-in ignores letter case.
                </small>
              </div>
            </>
          )}
          <PasswordField id="password" label="New password" />
          <PasswordField id="confirmPassword" label="Confirm password" />
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <button className="btn" disabled={busy || !token}>
            {busy ? "Saving…" : signup ? "Create account" : "Set new password"}
          </button>
        </form>
      )}
      <p className="auth-links">
        <Link href="/login">Back to sign in</Link>
        {!signup && <Link href="/forgot-password">Get a reset link</Link>}
      </p>
    </AuthShell>
  );
}
