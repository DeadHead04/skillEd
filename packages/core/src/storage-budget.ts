import { statfs, mkdir, readdir, lstat, rm } from "node:fs/promises";
import { join } from "node:path";
export async function requireStorage(
  root: string,
  reserve = 2 * 1024 * 1024 * 1024,
) {
  await mkdir(root, { recursive: true });
  const info = await statfs(root);
  const free = Number(info.bavail) * Number(info.bsize);
  if (free < reserve)
    throw new Error(
      `Storage unavailable: at least ${Math.ceil(reserve / 1024 ** 2)} MiB free space is required`,
    );
  return { availableBytes: free, reservedBytes: reserve };
}
/** Only abandoned temporary workspaces; never delete referenced immutable artifacts. */
export async function cleanWorkspaces(root: string, activeIds: string[] = []) {
  await mkdir(root, { recursive: true });
  let removed = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      entry.isSymbolicLink() ||
      activeIds.some((id) => entry.name.includes(id))
    )
      continue;
    const path = join(root, entry.name);
    const info = await lstat(path);
    if (Date.now() - info.mtimeMs > 24 * 60 * 60_000) {
      await rm(path, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}
