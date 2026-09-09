"use client";
import Link from "next/link";
import { useState } from "react";
import { FileTree, ReadMore } from "./studio";

export function SkillRegistry({ skills }: { skills: any[] }) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [view, setView] = useState("grid");
  const visible = skills.filter(
    (s) =>
      `${s.name} ${s.description}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "active"
          ? !!s.active_version_id
          : filter === "candidate"
            ? s.latest_version_id !== s.active_version_id &&
              s.latest_version > 1
            : !s.latestRun)),
  );
  return (
    <>
      <div className="registry-toolbar">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search Skills"
            placeholder="Search by name or purpose…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Filter Skills"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All packages</option>
          <option value="active">Active</option>
          <option value="candidate">New versions</option>
          <option value="untested">Not tested</option>
        </select>
        <div className="segmented" aria-label="Registry layout">
          <button
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            Cards
          </button>
          <button
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            List
          </button>
        </div>
      </div>
      <p className="registry-count">
        {visible.length} {visible.length === 1 ? "package" : "packages"}
      </p>
      <div className={`registry ${view}`}>
        {visible.map((s) => (
          <article className="skill-card" key={s.id}>
            <div className="card-top">
              <span className="package-icon">◇</span>
              <span className="status">
                {s.active_version_id
                  ? `Active v${s.active_version}`
                  : "Not activated"}
              </span>
            </div>
            <Link className="card-title" href={`/skill?skill=${s.id}`}>
              {s.name}
            </Link>
            <ReadMore text={s.description ?? "No description recorded."} />
            <div className="card-facts">
              <span>
                Latest <b>v{s.latest_version ?? s.active_version}</b>
              </span>
              <span>
                {s.latestRun?.summary.total
                  ? `${s.latestRun.summary.pass}/${s.latestRun.summary.total} cases passed`
                  : "Not evaluated"}
              </span>
            </div>
            <details className="card-files">
              <summary>
                Package contents{" "}
                <span>{s.manifest?.entries?.length ?? 0} files</span>
              </summary>
              <FileTree
                entries={s.manifest?.entries ?? []}
                base={`/skill?skill=${s.id}&version=${s.displayed_version_id}`}
              />
            </details>
            <Link className="card-open" href={`/skill?skill=${s.id}`}>
              Open workspace <span>↗</span>
            </Link>
          </article>
        ))}
      </div>
      {!visible.length && (
        <div className="studio-empty">
          <h2>
            {skills.length
              ? "No matching Skills"
              : "Your first Skill starts here"}
          </h2>
          <p>
            {skills.length
              ? "Try a different search or filter."
              : "Upload a package and see what it needs to succeed at your task."}
          </p>
          {!skills.length && (
            <Link className="btn" href="/skill?new=1">
              Add Skill package
            </Link>
          )}
        </div>
      )}
    </>
  );
}
