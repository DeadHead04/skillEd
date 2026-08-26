import { NextResponse } from "next/server";
import { isWorkspaceMember, upsertGithubConnection } from "@skilled/db";
import {
  getInstallationAccount,
  verifyGithubInstallState,
} from "@skilled/github";
import { apiError, internalApiError } from "../../../../../lib/api";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const installationId = url.searchParams.get("installation_id");
    const state = url.searchParams.get("state");
    if (!installationId || !state) {
      return apiError(
        "INTERNAL_ERROR",
        "GitHub installation callback is incomplete.",
        400,
      );
    }
    const verified = verifyGithubInstallState(state);
    if (!(await isWorkspaceMember(verified.userId, verified.workspaceId))) {
      return apiError("WORKSPACE_FORBIDDEN", "Workspace access denied.", 403);
    }
    const account = await getInstallationAccount(installationId);
    await upsertGithubConnection({
      workspaceId: verified.workspaceId,
      installationId,
      accountId: account.id,
      accountLogin: account.login,
    });
    return NextResponse.redirect(
      new URL(
        `/workspaces/${verified.workspaceId}/skills?github=connected`,
        request.url,
      ),
    );
  } catch {
    return internalApiError();
  }
}
