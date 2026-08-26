import { createImportJob, getGithubConnection } from "@skilled/db";
import { parseGithubRepositoryUrl } from "@skilled/github";
import { z } from "zod";
import { authorizeWorkspace } from "../../../../../../../lib/authz";
import { apiError, internalApiError } from "../../../../../../../lib/api";

const bodySchema = z.object({
  repositoryUrl: z.string().url().max(500),
  ref: z.string().trim().min(1).max(200).optional(),
});

interface Context {
  params: Promise<{ workspaceId: string }>;
}

export async function POST(request: Request, context: Context) {
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
    if (!(await getGithubConnection(workspaceId))) {
      return apiError(
        "GITHUB_NOT_CONNECTED",
        "Connect the GitHub App first.",
        409,
      );
    }
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError(
        "INTERNAL_ERROR",
        "Enter a valid repository URL and optional ref.",
        400,
      );
    }
    let repository: { owner: string; repository: string };
    try {
      repository = parseGithubRepositoryUrl(parsed.data.repositoryUrl);
    } catch (error) {
      return apiError(
        "INTERNAL_ERROR",
        error instanceof Error ? error.message : "Enter a valid GitHub URL.",
        400,
      );
    }
    const job = await createImportJob({
      workspaceId,
      sourceType: "github",
      source: {
        type: "github",
        repositoryUrl: parsed.data.repositoryUrl,
        owner: repository.owner,
        repository: repository.repository,
        ...(parsed.data.ref ? { ref: parsed.data.ref } : {}),
      },
      createdBy: access.user.id,
    });
    return Response.json(
      { importId: job.id, status: job.state },
      { status: 202 },
    );
  } catch {
    return internalApiError();
  }
}
