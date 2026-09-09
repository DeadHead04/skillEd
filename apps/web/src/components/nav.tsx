"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "../lib/client-request";

export function AppShell({
  skills,
  currentUser,
  children,
}: {
  skills: Array<{ id: string; name: string }>;
  currentUser: {
    id: string;
    loginId: string;
    displayName: string;
    role: "administrator" | "operator";
  } | null;
  children: React.ReactNode;
}) {
  const path = usePathname(),
    search = useSearchParams(),
    router = useRouter();
  const [filter, setFilter] = useState("");
  const [signingOut, setSigningOut] = useState(false),
    [logoutError, setLogoutError] = useState("");
  if (
    ["/login", "/signup", "/forgot-password", "/reset-password"].includes(path)
  )
    return children;
  const selected = skills.find((s) => s.id === search.get("skill"));
  const query = selected ? `?skill=${selected.id}` : "";
  const workspace = /^\/(skill|evals|runs|improve|release)(\/|$)/.test(path);
  const steps = [
    ["Package", `/skill${query}`, path === "/skill"],
    ["Test plan", `/evals/current${query}`, path.startsWith("/evals")],
    ["Run", `/runs/new${query}`, path === "/runs/new"],
    [
      "Results",
      `/runs/current${query}`,
      path.startsWith("/runs/") && path !== "/runs/new",
    ],
    ["Improve", `/improve/current${query}`, path.startsWith("/improve")],
    ["Release", `/release${query}`, path === "/release"],
  ] as const;
  async function logout() {
    setSigningOut(true);
    setLogoutError("");
    const response = await apiFetch("/api/v1/auth/logout", { method: "POST" });
    if (!response.ok && response.status !== 401) {
      setSigningOut(false);
      setLogoutError("Could not sign out. Please retry.");
      return;
    }
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="studio-shell">
      <a className="skip-link" href="#workspace">
        Skip to content
      </a>
      <aside className="studio-rail">
        <Link className="studio-brand" href="/dashboard">
          <span className="studio-mark">S</span> SkillEd
          <span className="studio-edition">STUDIO</span>
        </Link>
        <nav className="studio-primary" aria-label="Primary">
          <Link
            href="/dashboard"
            aria-current={path === "/dashboard" ? "page" : undefined}
          >
            <span aria-hidden="true">◫</span> Dashboard
          </Link>
          <Link
            href="/skills"
            aria-current={path === "/skills" || workspace ? "page" : undefined}
          >
            <span aria-hidden="true">▦</span> Skills
          </Link>
        </nav>
        <details className="skill-picker">
          <summary>
            {selected?.name ?? "Find a Skill"}
            <span aria-hidden="true">⌄</span>
          </summary>
          <label className="sr-only" htmlFor="skill-search">
            Search Skill packages
          </label>
          <input
            id="skill-search"
            placeholder="Search packages…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <nav aria-label="Skill packages">
            {skills
              .filter((s) =>
                s.name.toLowerCase().includes(filter.toLowerCase()),
              )
              .map((s) => (
                <Link
                  key={s.id}
                  href={`/skill?skill=${s.id}`}
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    setFilter("");
                  }}
                >
                  {s.name}
                </Link>
              ))}
            {!skills.length && <p className="hint">No packages yet.</p>}
          </nav>
        </details>
        <Link className="btn secondary studio-upload" href="/skill?new=1">
          ＋ Add Skill package
        </Link>
        <div className="studio-rail-bottom">
          {currentUser?.role === "administrator" && (
            <nav aria-label="Administration">
              <Link href="/users">Team</Link>
              <Link href="/diagnostics">Diagnostics</Link>
            </nav>
          )}
          <Link
            className="studio-account"
            href="/account"
            aria-label="Your account"
          >
            <span className="avatar">
              {currentUser?.displayName?.slice(0, 1) ?? "S"}
            </span>
            <span>
              {currentUser?.displayName ?? "Account"}
              <small>{currentUser?.role}</small>
            </span>
          </Link>
          <button
            className="text-button"
            onClick={logout}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          {logoutError && <p role="alert">{logoutError}</p>}
        </div>
      </aside>
      <main className="studio-main" id="workspace">
        <header className="studio-topbar">
          <span>
            {workspace ? (
              <>
                <Link href="/skills">Skills</Link>
                <span className="crumb-separator">/</span>
                {selected?.name ?? "Workspace"}
              </>
            ) : path === "/skills" ? (
              "Skill registry"
            ) : path === "/dashboard" ? (
              "Overview"
            ) : (
              "Administration"
            )}
          </span>
          <span className="studio-private">Private team workspace</span>
        </header>
        {workspace && (
          <nav className="pipeline" aria-label="Skill workflow">
            {steps.map(([label, href, active], i) => (
              <Link
                key={label}
                href={href}
                aria-current={active ? "step" : undefined}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                {label}
              </Link>
            ))}
          </nav>
        )}
        {children}
      </main>
    </div>
  );
}
