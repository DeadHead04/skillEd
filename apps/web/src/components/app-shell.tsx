import Link from "next/link";
import { Layers3 } from "lucide-react";

export function AppShell({
  workspaceId,
  workspaceName,
  userName,
  children,
}: {
  workspaceId: string;
  workspaceName: string;
  userName: string;
  children: React.ReactNode;
}) {
  const initials = userName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link
          href={`/workspaces/${workspaceId}/skills`}
          className="brand"
          aria-label="SkillEd home"
        >
          <span className="brand-mark" aria-hidden="true" />
          <span>SkillEd</span>
        </Link>
        <div className="sidebar-label">Workspace</div>
        <Link
          href={`/workspaces/${workspaceId}/skills`}
          className="nav-link active"
        >
          <Layers3 size={19} aria-hidden="true" /> Skills
        </Link>
        <div className="user-card">
          <div className="avatar" aria-hidden="true">
            {initials}
          </div>
          <div>
            <div className="user-name">{userName}</div>
            <div className="user-role">User</div>
          </div>
        </div>
      </aside>
      <div className="content-shell">
        <header className="topbar">
          <span className="workspace-pill">{workspaceName}</span>
        </header>
        {children}
      </div>
    </div>
  );
}
