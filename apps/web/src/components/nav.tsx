"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function Nav() {
  const path = usePathname();
  const items = [
    ["/skill", "Skill"],
    ["/evals/current", "Evals"],
    ["/runs/current", "Runs"],
    ["/improve/current", "Improve"],
  ] as const;
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">S</span>SkillEd
      </div>
      <nav className="nav" aria-label="Primary">
        {items.map(([href, label]) => (
          <Link
            className={
              path.startsWith(href.split("/").slice(0, 2).join("/"))
                ? "active"
                : ""
            }
            href={href}
            key={href}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="local-note">
        <span className="dot" />
        Private local workbench
        <br />
        No public runner isolation
      </div>
    </aside>
  );
}
