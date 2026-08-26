import { selectImportCandidates } from "@skilled/db";
import { z } from "zod";
import { authorizeWorkspace } from "../../../../../../../../lib/authz";
import { apiError, internalApiError } from "../../../../../../../../lib/api";

const schema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1).max(2000),
});

interface Context {
  params: Promise<{ workspaceId: string; importId: string }>;
}

export async function POST(request: Request, context: Context) {
  try {
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
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      return apiError("INVALID_SELECTION", "Select at least one Skill.", 400);
    const selection = await selectImportCandidates(
      workspaceId,
      importId,
      parsed.data.candidateIds,
    );
    if (selection === "expired") {
      return apiError(
        "IMPORT_EXPIRED",
        "This import expired. Start a new import.",
        410,
      );
    }
    if (selection !== "accepted") {
      return apiError(
        "INVALID_SELECTION",
        "Selection is invalid, expired, or belongs elsewhere.",
        409,
      );
    }
    return Response.json({ importId, status: "persisting" }, { status: 202 });
  } catch {
    return internalApiError();
  }
}
