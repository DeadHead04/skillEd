import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveInside, resolveWorkspacePath } from "@skilled/skill-package";

export interface ArtifactStore {
  storeDirectory(sourceDirectory: string, checksum: string): Promise<string>;
  readFile(artifactKey: string, relativePath: string): Promise<Buffer>;
  resolveFile(artifactKey: string, relativePath: string): string;
}

export class FileSystemArtifactStore implements ArtifactStore {
  readonly root: string;

  constructor(root = process.env.ARTIFACT_ROOT ?? "./artifacts") {
    this.root = resolveWorkspacePath(root, "./artifacts");
  }

  async storeDirectory(
    sourceDirectory: string,
    checksum: string,
  ): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(checksum))
      throw new Error("Invalid artifact checksum.");
    await fs.mkdir(this.root, { recursive: true });
    const key = `packages/${checksum}`;
    const destination = resolveInside(this.root, key);

    try {
      await fs.access(destination);
      return key;
    } catch {
      // Continue with the atomic write.
    }

    const temporaryKey = `.staging/${checksum}-${randomUUID()}`;
    const temporary = resolveInside(this.root, temporaryKey);
    await fs.mkdir(path.dirname(temporary), { recursive: true });
    await fs.cp(sourceDirectory, temporary, {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
    });
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.rename(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await fs.rm(temporary, { recursive: true, force: true });
    }
    return key;
  }

  resolveFile(artifactKey: string, relativePath: string): string {
    const artifactRoot = resolveInside(this.root, artifactKey);
    return resolveInside(artifactRoot, relativePath);
  }

  async readFile(artifactKey: string, relativePath: string): Promise<Buffer> {
    return fs.readFile(this.resolveFile(artifactKey, relativePath));
  }
}
