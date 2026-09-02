import { createHash } from "node:crypto";
import { mkdir, open, rename, stat } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";

export class ArtifactStore {
  constructor(
    readonly root = process.env.ARTIFACT_ROOT ?? "./artifacts/local",
  ) {}
  path(key: string) {
    if (key.startsWith("/") || normalize(key).startsWith(".."))
      throw new Error("Unsafe artifact key");
    const target = resolve(this.root, key),
      base = resolve(this.root);
    if (!target.startsWith(`${base}/`)) throw new Error("Unsafe artifact key");
    return target;
  }
  async put(key: string, data: Buffer | Uint8Array) {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
    return {
      key,
      checksum: createHash("sha256").update(data).digest("hex"),
      size: data.byteLength,
    };
  }
  async exists(key: string) {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}
export function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}
