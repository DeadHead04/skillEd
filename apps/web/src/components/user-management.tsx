"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Status } from "./ui";

type ManagedUser = {
  id: string;
  loginId: string;
  displayName: string;
  role: "administrator" | "operator";
  active: boolean;
  lastLoginAt: string | null;
  passwordChangedAt: string;
  createdAt: string;
};

function date(value: string | null) {
  return value ? value.slice(0, 10) : "never";
}

export function UserManagement({
  initialUsers,
  currentUserId,
  activeAdministrators,
}: {
  initialUsers: ManagedUser[];
  currentUserId: string;
  activeAdministrators: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [passwords, setPasswords] = useState<Record<string, string>>({});

  async function request(
    url: string,
    method: string,
    body: unknown,
    successMessage = "Saved. Any session belonging to that account was signed out.",
  ) {
    setBusy(url);
    setMessage("");
    setError("");
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    setBusy("");
    if (!response.ok) {
      setError(result.detail ?? "The account could not be updated.");
      return false;
    }
    setMessage(successMessage);
    router.refresh();
    return true;
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const succeeded = await request(
      "/api/v1/users",
      "POST",
      {
        displayName: form.get("displayName"),
        loginId: form.get("loginId"),
        role: form.get("role"),
        password: form.get("password"),
      },
      "Account created. Share the temporary password outside SkillEd.",
    );
    if (succeeded) event.currentTarget.reset();
  }

  async function update(user: ManagedUser, body: Record<string, unknown>) {
    return request(`/api/v1/users/${user.id}`, "PATCH", body);
  }

  return (
    <>
      {(message || error) && (
        <div
          className={error ? "error-box" : "success-box"}
          role={error ? "alert" : "status"}
          style={{ marginTop: 20 }}
        >
          {error || message}
        </div>
      )}

      <section className="section" style={{ marginTop: 22 }}>
        <div className="section-head">
          <h2>People</h2>
          <span className="section-note num">
            {initialUsers.length}{" "}
            {initialUsers.length === 1 ? "account" : "accounts"}
          </span>
        </div>
        <div className="rows">
          {initialUsers.map((user) => {
            const self = user.id === currentUserId;
            const lastAdministrator =
              user.active &&
              user.role === "administrator" &&
              activeAdministrators === 1;
            return (
              <article
                className={`user-row ${user.active ? "" : "inactive"}`}
                key={user.id}
              >
                <div className="user-identity">
                  <div className="avatar" aria-hidden="true">
                    {user.displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <h3>
                      {user.displayName} {self && <span>(you)</span>}
                    </h3>
                    <p>@{user.loginId}</p>
                  </div>
                </div>

                <div className="user-facts">
                  <Status
                    value={user.active ? "pass" : "absent"}
                    label={user.active ? "Active" : "Inactive"}
                  />
                  <span>
                    {user.role === "administrator"
                      ? "Administrator"
                      : "Operator"}
                  </span>
                  <span>Last sign-in {date(user.lastLoginAt)}</span>
                </div>

                <div className="user-actions">
                  <button
                    className="btn secondary"
                    disabled={
                      busy !== "" ||
                      self ||
                      (user.role === "administrator" && lastAdministrator)
                    }
                    onClick={() =>
                      update(user, {
                        role:
                          user.role === "administrator"
                            ? "operator"
                            : "administrator",
                      })
                    }
                  >
                    {user.role === "administrator"
                      ? "Make operator"
                      : "Make administrator"}
                  </button>
                  <button
                    className="btn secondary"
                    disabled={busy !== "" || self || lastAdministrator}
                    onClick={() => {
                      if (
                        user.active &&
                        !window.confirm(
                          `Deactivate ${user.displayName}? Their sessions stop working immediately.`,
                        )
                      )
                        return;
                      void update(user, { active: !user.active });
                    }}
                  >
                    {user.active ? "Deactivate" : "Reactivate"}
                  </button>
                </div>

                <details className="password-reset">
                  <summary>Reset password</summary>
                  <div className="inline-reset">
                    <div>
                      <label htmlFor={`password-${user.id}`}>
                        New password
                      </label>
                      <input
                        id={`password-${user.id}`}
                        type="password"
                        minLength={12}
                        maxLength={128}
                        autoComplete="new-password"
                        value={passwords[user.id] ?? ""}
                        onChange={(event) =>
                          setPasswords((current) => ({
                            ...current,
                            [user.id]: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <button
                      className="btn"
                      disabled={
                        busy !== "" || (passwords[user.id]?.length ?? 0) < 12
                      }
                      onClick={async () => {
                        if (
                          await update(user, { password: passwords[user.id] })
                        )
                          setPasswords((current) => ({
                            ...current,
                            [user.id]: "",
                          }));
                      }}
                    >
                      Reset and sign out
                    </button>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Add account</h2>
          <span className="section-note">Administrator action</span>
        </div>
        <form className="create-user-form" onSubmit={create}>
          <div className="field">
            <label htmlFor="displayName">Display name</label>
            <input
              id="displayName"
              name="displayName"
              maxLength={80}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="newLoginId">Login ID</label>
            <input
              id="newLoginId"
              name="loginId"
              minLength={3}
              maxLength={40}
              pattern="[a-z0-9][a-z0-9._-]*"
              autoComplete="off"
              required
            />
            <small>
              Lowercase letters, numbers, periods, underscores, or hyphens.
            </small>
          </div>
          <div className="field">
            <label htmlFor="newRole">Role</label>
            <select id="newRole" name="role" defaultValue="operator">
              <option value="operator">Operator</option>
              <option value="administrator">Administrator</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="newPassword">Temporary password</label>
            <input
              id="newPassword"
              name="password"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
            <small>12 to 128 characters. Share it outside SkillEd.</small>
          </div>
          <button className="btn" disabled={busy !== ""}>
            {busy === "/api/v1/users" ? "Creating…" : "Create account"}
          </button>
        </form>
        <p className="hint" style={{ marginTop: 16, maxWidth: 380 }}>
          Operators can run and improve every Skill package. They cannot add,
          deactivate, promote, or reset accounts.
        </p>
      </section>
    </>
  );
}
