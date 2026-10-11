// Modified for the skilled TypeScript distribution.
import * as fs from "node:fs/promises";
import path from "node:path";
export async function copyFile(
  source: string,
  target: string,
  signal?: AbortSignal,
  preserveMode = true,
  exclusive = false,
  applyMode = true,
  creationMode?: number,
): Promise<void> {
  signal?.throwIfAborted();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const stat = await fs.stat(source);
  if (!stat.isFile()) throw new Error(`not a regular file: ${source}`);
  const input = await fs.open(source, "r");
  let output: fs.FileHandle | undefined;
  try {
    output = await fs.open(
      target,
      exclusive ? "wx" : "w",
      creationMode ?? (preserveMode ? stat.mode & 0o777 : 0o600),
    );
    const buf = Buffer.alloc(32768);
    while (true) {
      signal?.throwIfAborted();
      const { bytesRead } = await input.read(buf, 0, buf.length, null);
      if (!bytesRead) break;
      let offset = 0;
      while (offset < bytesRead) {
        signal?.throwIfAborted();
        const result = await output.write(
          buf,
          offset,
          bytesRead - offset,
          null,
        );
        offset += result.bytesWritten;
      }
    }
  } finally {
    await input.close();
    await output?.close();
  }
  if (preserveMode && applyMode) await fs.chmod(target, stat.mode & 0o777);
}
export async function copyTree(
  source: string,
  target: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const stat = await fs.stat(source);
  if (!stat.isDirectory()) throw new Error(`not a directory: ${source}`);
  await fs.mkdir(target, { recursive: true, mode: stat.mode & 0o777 });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    signal?.throwIfAborted();
    const src = path.join(source, entry.name),
      dst = path.join(target, entry.name);
    if (entry.isDirectory()) await copyTree(src, dst, signal);
    else
      await copyFile(
        src,
        dst,
        signal,
        true,
        false,
        false,
        (await fs.lstat(src)).mode & 0o777,
      );
  }
}

/** Removes only a caller-owned snapshot tree; never follows symlinks. */
export async function removeOwnedTree(root: string): Promise<void> {
  async function unlock(dir: string): Promise<void> {
    const info = await fs.lstat(dir);
    if (!info.isDirectory()) return;
    await fs.chmod(dir, (info.mode & 0o777) | 0o700);
    for (const entry of await fs.readdir(dir, { withFileTypes: true }))
      if (entry.isDirectory()) await unlock(path.join(dir, entry.name));
  }
  try {
    await unlock(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await fs.rm(root, { recursive: true, force: true });
}
export async function copyJudgeTree(
  source: string,
  target: string,
  signal?: AbortSignal,
): Promise<void> {
  const root = await fs.realpath(source);
  const metadata: { name: string; mode: number; modified: Date }[] = [];
  async function visit(src: string, dst: string): Promise<void> {
    signal?.throwIfAborted();
    const info = await fs.lstat(src);
    if (info.isDirectory()) {
      await fs.mkdir(dst, { recursive: true, mode: 0o700 });
      metadata.push({
        name: dst,
        mode: src === root ? 0o700 : info.mode & 0o777,
        modified: info.mtime,
      });
      for (const entry of await fs.readdir(src))
        await visit(path.join(src, entry), path.join(dst, entry));
    } else if (info.isSymbolicLink()) {
      const link = await fs.readlink(src),
        resolved = await fs.realpath(src);
      if (
        path.isAbsolute(link) ||
        (resolved !== root && !resolved.startsWith(root + path.sep))
      )
        throw new Error(
          `judge snapshot rejects symlink outside workspace: ${src}`,
        );
      await fs.symlink(link, dst);
    } else if (info.isFile()) {
      if (path.basename(src) === ".git")
        throw new Error(
          `judge snapshot rejects Git metadata pointer file: ${src}`,
        );
      await copyFile(src, dst, signal, true, true);
      await fs.utimes(dst, info.mtime, info.mtime);
    } else throw new Error(`judge snapshot cannot copy special file: ${src}`);
  }
  await visit(root, target);
  for (const item of metadata.reverse()) {
    await fs.utimes(item.name, item.modified, item.modified);
    await fs.chmod(item.name, item.mode);
  }
}
