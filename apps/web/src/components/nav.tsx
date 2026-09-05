"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { evalStage, proposalStage, runStage } from "../lib/labels";

type Summary = {
  total: number;
  pass: number;
  partial: number;
  fail: number;
  error: number;
};

type SkillSummary = {
  id: string;
  name: string;
  active_version?: number;
  latestRun?: { status: string; summary: Summary } | null;
  stages?: {
    evals: { id: string | null; status: string | null; version: number | null };
    runs: { id: string | null; status: string | null; summary: Summary | null };
    improve: { id: string | null; status: string | null; activated: boolean };
  };
};

export function AppShell({
  skills,
  currentUser,
  children,
}: {
  skills: SkillSummary[];
  currentUser: {
    id: string;
    loginId: string;
    displayName: string;
    role: "administrator" | "operator";
  } | null;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  if (path === "/login") return children;

  const requested = search.get("skill");
  const selected = skills.find((skill) => skill.id === requested) ?? skills[0];
  const query = selected ? `?skill=${selected.id}` : "";
  const stages = selected?.stages;

  // Stage state lives on the navigation and nowhere else — the previous build
  // repeated it in a second strip, which the design language calls drift.
  const items = [
    {
      href: "/skill",
      label: "Package",
      detail: selected?.active_version
        ? `v${selected.active_version} active`
        : "Upload a package",
      tone: selected?.active_version ? "done" : "attention",
    },
    {
      href: "/evals/current",
      label: "Evals",
      detail: evalStage(
        stages?.evals.status ?? null,
        stages?.evals.version ?? null,
      ).detail,
      tone: evalStage(
        stages?.evals.status ?? null,
        stages?.evals.version ?? null,
      ).tone,
    },
    {
      href: "/runs/current",
      label: "Runs",
      detail: runStage(
        stages?.runs.status ?? null,
        stages?.runs.summary ?? null,
      ).detail,
      tone: runStage(stages?.runs.status ?? null, stages?.runs.summary ?? null)
        .tone,
    },
    {
      href: "/improve/current",
      label: "Improve",
      detail: proposalStage(
        stages?.improve.status ?? null,
        stages?.improve.activated ?? false,
      ).detail,
      tone: proposalStage(
        stages?.improve.status ?? null,
        stages?.improve.activated ?? false,
      ).tone,
    },
  ];

  const glyph = (tone: string) =>
    tone === "done" ? "✓" : tone === "blocked" ? "!" : "·";

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="app">
      <aside className="rail">
        <Link className="brand" href={`/skill${query}`}>
          <span className="brand-mark">S</span>SkillEd
        </Link>

        <div>
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
                        : "Not tested yet"
                    }
                  >
                    {summary?.total ? `${summary.pass}/${summary.total}` : "—"}
                  </span>
                </Link>
              );
            })}
          </nav>
          <Link className="add-skill" href="/skill?new=1">
            Add Skill package
          </Link>
        </div>

        <div>
          <div className="side-label">Workflow</div>
          <nav className="nav" aria-label="Primary">
            {items.map((item) => (
              <Link
                className={`${
                  path.startsWith(item.href.split("/").slice(0, 2).join("/"))
                    ? "active"
                    : ""
                } ${item.tone}`}
                href={`${item.href}${query}`}
                key={item.href}
              >
                <span className="glyph" aria-hidden="true">
                  {glyph(item.tone)}
                </span>
                <span>
                  {item.label}
                  <small aria-hidden="true">{item.detail}</small>
                </span>
              </Link>
            ))}
            {currentUser?.role === "administrator" && (
              <Link className={path === "/users" ? "active" : ""} href="/users">
                <span className="glyph" aria-hidden="true">
                  ·
                </span>
                <span>Users</span>
              </Link>
            )}
          </nav>
        </div>

        <div className="rail-foot">
          <span className="account">
            <b>{currentUser?.displayName ?? "Signed in"}</b>
            <small>
              {currentUser?.role === "administrator"
                ? "Administrator"
                : "Operator"}
            </small>
          </span>
          <button className="text-button" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="context-strip">
          <div className="context">
            {selected ? (
              <>
                <b>{selected.name}</b>
                <span className="pin">
                  active v{selected.active_version ?? "—"}
                </span>
                {stages?.evals.version ? (
                  <span className="pin">eval v{stages.evals.version}</span>
                ) : null}
              </>
            ) : (
              "No Skill package selected"
            )}
          </div>
          <div className="worker-status">
            <span className="dot" />
            One job at a time
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
