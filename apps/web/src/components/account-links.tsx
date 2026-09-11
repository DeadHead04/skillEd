"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/client-request";
import { Spinner } from "./processing";
type LinkRecord = {
  id: string;
  kind: string;
  label: string;
  role: string;
  login_id: string | null;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
};
export function AccountLinks({
  users,
}: {
  users: {
    id: string;
    loginId: string;
    displayName: string;
    active: boolean;
  }[];
}) {
  const [links, setLinks] = useState<LinkRecord[]>([]),
    [busy, setBusy] = useState(""),
    [linksBusy, setLinksBusy] = useState(false),
    [error, setError] = useState("");
  const [issued, setIssued] = useState<{ url: string; expires: string } | null>(
      null,
    ),
    [copied, setCopied] = useState(false);
  async function refresh() {
    setLinksBusy(true);
    try {
      const response = await apiFetch("/api/v1/users/access-links");
      const result = await response.json();
      if (response.ok) setLinks(result.links);
      else setError(result.detail ?? "Account links could not be loaded.");
    } finally {
      setLinksBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function issue(
    event: React.FormEvent<HTMLFormElement>,
    kind: "invitation" | "password_reset",
  ) {
    event.preventDefault();
    setBusy(kind);
    setError("");
    setIssued(null);
    setCopied(false);
    const form = event.currentTarget;
    const response = await apiFetch("/api/v1/users/access-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), kind }),
    });
    const result = await response.json();
    setBusy("");
    if (!response.ok) {
      setError(
        result.detail ??
          "The link could not be created. Check the list before retrying.",
      );
      return;
    }
    setIssued({
      url: new URL(result.path, window.location.origin).href,
      expires: result.expiresAt,
    });
    form.reset();
    await refresh();
  }
  async function revoke(id: string) {
    setBusy(`revoke:${id}`);
    setError("");
    const response = await apiFetch("/api/v1/users/access-links", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusy("");
    if (!response.ok) {
      setError((await response.json()).detail ?? "Revocation failed.");
      return;
    }
    setIssued(null);
    await refresh();
  }
  return (
    <section className="section">
      <div className="section-head">
        <h2>Invite someone</h2>
        <span className="section-note">
          They choose their own login ID and password
        </span>
      </div>
      <form
        onSubmit={(e) => void issue(e, "invitation")}
        className="create-user-form"
      >
        <div className="field">
          <label htmlFor="inviteLabel">Invitation name</label>
          <input
            id="inviteLabel"
            name="label"
            placeholder="For example, Alex from the team"
            maxLength={80}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="inviteRole">Invitation role</label>
          <select id="inviteRole" name="role" defaultValue="operator">
            <option value="operator">Operator</option>
            <option value="administrator">Administrator</option>
          </select>
        </div>
        <button
          className="btn"
          disabled={busy !== ""}
          aria-busy={busy === "invitation"}
        >
          {busy === "invitation" ? "Working…" : "Create signup link"}
        </button>
      </form>
      <p className="hint">
        Each invitation can be used once within seven days. Anyone holding the
        link can claim its role; share it directly with the intended person.
      </p>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {issued && (
        <div className="account-link-result" role="status">
          <b>Link ready — copy it now</b>
          <p>
            Expires {new Date(issued.expires).toLocaleString()}. The full link
            will not be shown again after refresh.
          </p>
          <label htmlFor="accountLink">Private account link</label>
          <input
            id="accountLink"
            value={issued.url}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button
            className="btn secondary"
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued.url);
                setCopied(true);
              } catch {
                setError("Select the link field and copy it manually.");
              }
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
      <details className="account-recovery">
        <summary>Help someone reset their password</summary>
        <p>
          Verify who is requesting access before sharing a reset link. It
          expires in one hour and replaces any previous reset link. Sessions end
          when the person sets a new password.
        </p>
        <form
          onSubmit={(e) => void issue(e, "password_reset")}
          className="create-user-form"
        >
          <div className="field">
            <label htmlFor="resetUser">Account to recover</label>
            <select id="resetUser" name="userId" required defaultValue="">
              <option value="" disabled>
                Choose an active account
              </option>
              {users
                .filter((u) => u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} (@{u.loginId})
                  </option>
                ))}
            </select>
          </div>
          <button
            className="btn secondary"
            disabled={busy !== ""}
            aria-busy={busy === "password_reset"}
          >
            {busy === "password_reset" ? "Working…" : "Create reset link"}
          </button>
        </form>
      </details>
      <details className="account-recovery">
        <summary>
          Issued links ({links.length})
          {linksBusy && (
            <span className="processing-label account-links-progress">
              <Spinner /> Refreshing…
            </span>
          )}
        </summary>
        <button
          type="button"
          className="text-button"
          onClick={() => void refresh()}
          disabled={linksBusy}
          aria-busy={linksBusy}
        >
          Refresh links
        </button>
        <div className="rows">
          {links.map((link) => {
            const state = link.used_at
              ? "Used"
              : link.revoked_at
                ? "Revoked"
                : new Date(link.expires_at).getTime() <= Date.now()
                  ? "Expired"
                  : "Available";
            return (
              <div className="row plain" key={link.id}>
                <div>
                  <b>
                    {link.kind === "invitation"
                      ? link.label
                      : `Reset @${link.login_id}`}
                  </b>
                  <p className="hint">
                    {link.kind === "invitation" ? link.role : "Password reset"}{" "}
                    · {state} · Expires{" "}
                    {new Date(link.expires_at).toLocaleString()}
                  </p>
                </div>
                {state === "Available" && (
                  <button
                    className="btn quiet"
                    disabled={busy !== ""}
                    aria-busy={busy === `revoke:${link.id}`}
                    onClick={() => void revoke(link.id)}
                    aria-label={`Revoke ${link.label || link.login_id}`}
                  >
                    {busy === `revoke:${link.id}` ? "Revoking…" : "Revoke"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}
