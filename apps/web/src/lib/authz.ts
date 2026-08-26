import { cookies } from "next/headers";
import { auth } from "../auth";
import {
  ensureIdentityWorkspace,
  getUserWorkspace,
  isWorkspaceMember,
} from "@skilled/db";

const DEV_COOKIE = "skilled-dev-session";

export function devBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_AUTH_BYPASS === "true"
  );
}

export async function currentUser(): Promise<{
  id: string;
  name: string;
  email: string | null;
  image: string | null;
} | null> {
  const devIdentity = (await cookies()).get(DEV_COOKIE)?.value;
  if (devBypassEnabled() && devIdentity) {
    const emptyProfile = devIdentity === "empty-user";
    const { user } = await ensureIdentityWorkspace({
      githubUserId: emptyProfile ? "empty-user" : "dev-user",
      name: emptyProfile ? "Empty User" : "Alex Smith",
      email: emptyProfile ? "empty@skilled.local" : "dev@skilled.local",
    });
    return user;
  }
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    name: session.user.name ?? "GitHub user",
    email: session.user.email ?? null,
    image: session.user.image ?? null,
  };
}

export async function currentUserWorkspace() {
  const user = await currentUser();
  if (!user) return null;
  const workspace = await getUserWorkspace(user.id);
  return workspace ? { user, workspace } : null;
}

export async function authorizeWorkspace(workspaceId: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, status: 401 as const, user: null };
  if (!(await isWorkspaceMember(user.id, workspaceId))) {
    return { ok: false as const, status: 403 as const, user };
  }
  return { ok: true as const, status: 200 as const, user };
}

export { DEV_COOKIE };
