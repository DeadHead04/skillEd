import { lstat, open } from "node:fs/promises";
import { constants, type BigIntStats } from "node:fs";
import path from "node:path";

function requireUnchangedFile(before: BigIntStats, after: BigIntStats): void {
  // Some filesystems do not expose a stable inode. Compare identity whenever
  // available, and always reject non-files or a change during the read.
  if (!after.isFile() || after.isSymbolicLink() ||
    (before.ino !== 0n && after.ino !== 0n &&
      (before.ino !== after.ino || before.dev !== after.dev)) ||
    before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs)
    throw new Error("codex_auth_file changed while being read; select a stable regular file and retry");
}

/** Read only an explicitly selected native login file; never include its contents in errors. */
export async function readCodexAuthFile(file: string): Promise<Buffer> {
  if (!path.isAbsolute(file)) throw new Error("codex_auth_file must be an absolute host path");
  let handle;
  let before: BigIntStats;
  try {
    before = await lstat(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("not a regular file");
    // O_NOFOLLOW is additional protection on supporting systems; lstat and
    // descriptor identity checks remain mandatory, including on Windows.
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    throw new Error("codex_auth_file must be a readable regular file, not a symlink");
  }
  try {
    const info = await handle.stat({ bigint: true });
    requireUnchangedFile(before, info);
    requireUnchangedFile(info, await lstat(file, { bigint: true }));
    if (info.size < 1n || info.size > 1024n * 1024n)
      throw new Error("codex_auth_file must be a regular file between 1 byte and 1 MiB");
    const bytes = await handle.readFile();
    requireUnchangedFile(info, await handle.stat({ bigint: true }));
    requireUnchangedFile(info, await lstat(file, { bigint: true }));
    if (bytes.length > 1024 * 1024) throw new Error("codex_auth_file exceeds 1 MiB");
    let auth;
    try { auth = JSON.parse(bytes.toString("utf8")); }
    catch { throw new Error("codex_auth_file must contain valid native ChatGPT login JSON"); }
    if (!auth || auth.auth_mode !== "chatgpt" || auth.OPENAI_API_KEY ||
      typeof auth.tokens?.access_token !== "string" || !auth.tokens.access_token ||
      typeof auth.tokens?.refresh_token !== "string" || !auth.tokens.refresh_token)
      throw new Error("codex_auth_file requires an existing ChatGPT login with tokens; API-key authentication is not accepted");
    return bytes;
  } finally { await handle.close(); }
}
