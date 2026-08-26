import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createImportJob } from "@skilled/db";
import {
  importLimitsFromEnv,
  normalizePackagePath,
  resolveInside,
  resolveWorkspacePath,
} from "@skilled/skill-package";
import { authorizeWorkspace } from "../../../../../../../lib/authz";
import { apiError, internalApiError } from "../../../../../../../lib/api";

interface Context {
  params: Promise<{ workspaceId: string }>;
}

function stagingRoot(): string {
  return resolveWorkspacePath(process.env.IMPORT_STAGING_ROOT, "./tmp/imports");
}

export async function POST(request: Request, context: Context) {
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

  const limits = importLimitsFromEnv();
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > limits.maxArchiveBytes + 1024 * 1024) {
    return apiError(
      "IMPORT_LIMIT_EXCEEDED",
      "Upload exceeds the configured limit.",
      413,
    );
  }

  const importId = randomUUID();
  const jobRoot = resolveInside(stagingRoot(), importId);
  try {
    const form = await request.formData();
    const mode = form.get("mode") === "folder" ? "folder" : "zip";
    const uploadNameValue = form.get("uploadName");
    const uploadName =
      typeof uploadNameValue === "string" && uploadNameValue.trim()
        ? uploadNameValue.trim().slice(0, 200)
        : "uploaded-skill";
    await fs.mkdir(jobRoot, { recursive: true });

    let stagedPath: string;
    if (mode === "zip") {
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        file.size === 0 ||
        file.size > limits.maxArchiveBytes
      ) {
        await fs.rm(jobRoot, { recursive: true, force: true });
        return apiError(
          "IMPORT_LIMIT_EXCEEDED",
          "Choose a ZIP within the upload limit.",
          400,
        );
      }
      const destination = path.join(jobRoot, "source.zip");
      await fs.writeFile(destination, Buffer.from(await file.arrayBuffer()), {
        flag: "wx",
        mode: 0o600,
      });
      stagedPath = path.relative(stagingRoot(), destination);
    } else {
      const files = form
        .getAll("files")
        .filter((value): value is File => value instanceof File);
      const paths = form
        .getAll("paths")
        .filter((value): value is string => typeof value === "string");
      if (
        files.length === 0 ||
        files.length !== paths.length ||
        files.length > limits.maxFiles
      ) {
        await fs.rm(jobRoot, { recursive: true, force: true });
        return apiError(
          "IMPORT_LIMIT_EXCEEDED",
          "Folder selection is empty or exceeds limits.",
          400,
        );
      }
      const folderRoot = path.join(jobRoot, "folder");
      const seen = new Set<string>();
      let totalBytes = 0;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!;
        const normalized = normalizePackagePath(
          paths[index]!,
          limits.maxPathDepth,
        );
        const collision = normalized.toLocaleLowerCase("en-US");
        totalBytes += file.size;
        if (
          seen.has(collision) ||
          file.size > limits.maxFileBytes ||
          totalBytes > limits.maxUncompressedBytes
        ) {
          await fs.rm(jobRoot, { recursive: true, force: true });
          return apiError(
            "IMPORT_LIMIT_EXCEEDED",
            "Folder contains duplicate or oversized files.",
            400,
          );
        }
        seen.add(collision);
        const destination = resolveInside(folderRoot, normalized);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, Buffer.from(await file.arrayBuffer()), {
          flag: "wx",
          mode: 0o600,
        });
      }
      stagedPath = path.relative(stagingRoot(), folderRoot);
    }

    const job = await createImportJob({
      id: importId,
      workspaceId,
      sourceType: "upload",
      source: { type: "upload", uploadName, mode, stagedPath },
      createdBy: access.user.id,
    });
    return Response.json(
      { importId: job.id, status: job.state },
      { status: 202 },
    );
  } catch {
    await fs.rm(jobRoot, { recursive: true, force: true });
    return internalApiError();
  }
}
