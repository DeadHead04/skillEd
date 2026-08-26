import { FileSystemArtifactStore } from "@skilled/artifact-store";
import { getSkillDetail } from "@skilled/db";
import { isInlineImage, isPreviewableText } from "@skilled/skill-package";
import { authorizeWorkspace } from "../../../../../../../../../../../lib/authz";
import {
  apiError,
  internalApiError,
} from "../../../../../../../../../../../lib/api";
import { safeFileHeaders } from "../../../../../../../../../../../lib/file-response";

interface Context {
  params: Promise<{
    workspaceId: string;
    skillId: string;
    versionId: string;
    filePath: string[];
  }>;
}

export async function GET(request: Request, context: Context) {
  try {
    const { workspaceId, skillId, versionId, filePath } = await context.params;
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
      return apiError("FILE_NOT_PREVIEWABLE", "File was not found.", 404);
    const relativePath = filePath.join("/");
    const manifestFile = detail.version.packageManifest.files.find(
      (item) => item.relativePath === relativePath,
    );
    if (!manifestFile)
      return apiError("FILE_NOT_PREVIEWABLE", "File was not found.", 404);
    const content = await new FileSystemArtifactStore().readFile(
      detail.version.artifactKey,
      relativePath,
    );
    const download = new URL(request.url).searchParams.get("download") === "1";
    const inline =
      !download &&
      manifestFile.byteSize <= 512 * 1024 &&
      (isPreviewableText(manifestFile.mediaType) ||
        isInlineImage(manifestFile.mediaType));
    return new Response(new Uint8Array(content), {
      headers: safeFileHeaders({
        relativePath,
        mediaType: manifestFile.mediaType,
        inline,
      }),
    });
  } catch {
    return internalApiError();
  }
}
