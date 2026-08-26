import { getGithubConnection } from "@skilled/db";
import { createGithubInstallState } from "@skilled/github";
import { authorizeWorkspace } from "../../../../../../../lib/authz";
import { apiError, internalApiError } from "../../../../../../../lib/api";

interface Context {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(_request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const access = await authorizeWorkspace(workspaceId);
  if (!access.ok) {
    return apiError(
      access.status === 401 ? "UNAUTHENTICATED" : "WORKSPACE_FORBIDDEN",
      access.status === 401
        ? "Sign in to continue."
        : "Workspace access denied.",
      access.status,
    );
  }
  const connection = await getGithubConnection(workspaceId);
  return Response.json({
    connected: connection?.status === "connected",
    accountLogin: connection?.accountLogin ?? null,
  });
}

export async function POST(_request: Request, context: Context) {
  try {
    const { workspaceId } = await context.params;
    const access = await authorizeWorkspace(workspaceId);
    if (!access.ok) {
      return apiError(
        access.status === 401 ? "UNAUTHENTICATED" : "WORKSPACE_FORBIDDEN",
        access.status === 401
          ? "Sign in to continue."
          : "Workspace access denied.",
        access.status,
      );
    }
    const slug = process.env.GITHUB_APP_SLUG;
    if (!slug) return internalApiError();
    const state = createGithubInstallState({
      workspaceId,
      userId: access.user.id,
    });
    const callback = new URL(
      "/api/v1/github/callback",
      process.env.APP_URL ?? "http://localhost:3000",
    );
    const installUrl = new URL(
      `https://github.com/apps/${slug}/installations/new`,
    );
    installUrl.searchParams.set("state", state);
    installUrl.searchParams.set("redirect_url", callback.toString());
    return Response.json({ installUrl: installUrl.toString() });
  } catch {
    return internalApiError();
  }
}
