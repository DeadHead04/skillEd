import { redirect } from "next/navigation";
import { currentUserWorkspace } from "../lib/authz";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const context = await currentUserWorkspace();
  if (!context) redirect("/login");
  redirect(`/workspaces/${context.workspace.id}/skills`);
}
