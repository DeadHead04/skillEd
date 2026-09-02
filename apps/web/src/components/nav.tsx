"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type SkillSummary = {
  id: string;
  name: string;
  active_version?: number;
  latestRun?: {
    status: string;
    summary: {
      total: number;
      pass: number;
      partial: number;
      fail: number;
      error: number;
    };
  } | null;
};

export function AppShell({
  skills,
  children,
}: {
  skills: SkillSummary[];
  children: React.ReactNode;
}) {
  const path = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  if (path === "/login") return children;

  const requested = search.get("skill");
  const selected = skills.find((skill) => skill.id === requested) ?? skills[0];
  const query = selected ? `?skill=${selected.id}` : "";
  const items = [
    ["/skill", "Package"],
    ["/evals/current", "Evals"],
    ["/runs/current", "Runs"],
    ["/improve/current", "Improve"],
  ] as const;

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <Link className="brand" href={`/skill${query}`}>
          <span className="brand-mark">S</span>SkillEd
        </Link>
        <div className="side-label">Skill packages</div>
        <nav className="skill-list" aria-label="Skill packages">
          {skills.map((skill) => {
            const summary = skill.latestRun?.summary;
            return (
              <Link
                key={skill.id}
                href={`/skill?skill=${skill.id}`}
                className={`skill-switch ${selected?.id === skill.id ? "active" : ""}`}
              >
                <span>
                  <b>{skill.name}</b>
                  <small>Active v{skill.active_version ?? "—"}</small>
                </span>
                <span
                  className="skill-score"
                  aria-label={
                    summary
                      ? `${summary.pass} of ${summary.total} cases passing`
                      : "Not tested"
                  }
                >
                  {summary?.total ? `${summary.pass}/${summary.total}` : "—"}
                </span>
              </Link>
            );
          })}
          <Link className="add-skill" href="/skill?new=1">
            + Add Skill package
          </Link>
        </nav>
        <div className="side-label workflow-label">Workflow</div>
        <nav className="nav" aria-label="Primary">
          {items.map(([href, label]) => (
            <Link
              className={
                path.startsWith(href.split("/").slice(0, 2).join("/"))
                  ? "active"
                  : ""
              }
              href={`${href}${query}`}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="local-note">
          <span className="dot" />
          Local administrator
          <button className="text-button" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="context">
            {selected ? (
              <>
                <b>{selected.name}</b> · active v
                {selected.active_version ?? "—"}
              </>
            ) : (
              "No Skill package selected"
            )}
          </div>
          <div className="status">
            <span className="dot" />
            Sequential worker
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
