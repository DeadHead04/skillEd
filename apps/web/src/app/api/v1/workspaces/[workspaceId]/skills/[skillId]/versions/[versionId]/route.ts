import { getSkillDetail } from "@skilled/db";
import { authorizeWorkspace } from "../../../../../../../../../lib/authz";
import { apiError } from "../../../../../../../../../lib/api";

interface Context {
  params: Promise<{ workspaceId: string; skillId: string; versionId: string }>;
}

export async function GET(_request: Request, context: Context) {
  const { workspaceId, skillId, versionId } = await context.params;
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
  const detail = await getSkillDetail(workspaceId, skillId, versionId);
  if (!detail)
    return apiError("INTERNAL_ERROR", "Skill version was not found.", 404);
  return Response.json(detail);
}
