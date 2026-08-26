import { notFound, redirect } from "next/navigation";
import { getUserWorkspace, isWorkspaceMember } from "@skilled/db";
import { currentUser } from "../../../lib/authz";
import { AppShell } from "../../../components/app-shell";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { workspaceId } = await params;
  if (!(await isWorkspaceMember(user.id, workspaceId))) notFound();
  const workspace = await getUserWorkspace(user.id);
  if (!workspace || workspace.id !== workspaceId) notFound();
  return (
    <AppShell
      workspaceId={workspaceId}
      workspaceName={workspace.name}
      userName={user.name}
    >
      {children}
    </AppShell>
  );
}
