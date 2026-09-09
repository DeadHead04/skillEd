"use client";
import { useState } from "react";
import { apiFetch } from "../lib/client-request";
import { PasswordField } from "./password-field";
export function ChangePassword() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const input = Object.fromEntries(new FormData(form));
    if (input.password !== input.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const response = await apiFetch("/api/v1/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(result.detail ?? "Password change failed.");
      return;
    }
    form.reset();
    window.location.assign("/login?passwordChanged=1");
  }
  return (
    <form onSubmit={submit} className="login-form account-form">
      <PasswordField id="currentPassword" label="Current password" current />
      <PasswordField id="password" label="New password" />
      <PasswordField id="confirmPassword" label="Confirm password" />
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <p className="hint">
        Changing your password signs out every session, including this one.
      </p>
      <button className="btn" disabled={busy}>
        {busy ? "Saving…" : "Change password and sign out"}
      </button>
    </form>
  );
}
