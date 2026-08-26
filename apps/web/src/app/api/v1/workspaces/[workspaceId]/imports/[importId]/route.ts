import { getImportJobView } from "@skilled/db";
import { authorizeWorkspace } from "../../../../../../../lib/authz";
import { apiError } from "../../../../../../../lib/api";

interface Context {
  params: Promise<{ workspaceId: string; importId: string }>;
}

export async function GET(_request: Request, context: Context) {
  const { workspaceId, importId } = await context.params;
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
  const job = await getImportJobView(workspaceId, importId);
  if (!job) return apiError("INTERNAL_ERROR", "Import was not found.", 404);
  return Response.json(job);
}
