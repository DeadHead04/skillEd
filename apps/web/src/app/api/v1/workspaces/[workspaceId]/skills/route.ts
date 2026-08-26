import { listSkills } from "@skilled/db";
import { authorizeWorkspace } from "../../../../../../lib/authz";
import { apiError } from "../../../../../../lib/api";
import { parseCatalogQuery } from "../../../../../../lib/catalog";

interface Context {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(request: Request, context: Context) {
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
  const search = Object.fromEntries(
    new URL(request.url).searchParams.entries(),
  );
  const query = parseCatalogQuery(search);
  const result = await listSkills(workspaceId, query);
  return Response.json({
    ...result,
    page: query.page,
    pageSize: query.pageSize,
  });
}
