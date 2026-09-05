import { createHash } from "node:crypto";
import { mkdir, open, link, stat, readFile, unlink } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { serviceEndpoint } from "./service-config";
import { signArtifactGrant } from "./grants";

export class ArtifactStore {
  constructor(
    readonly root = process.env.ARTIFACT_ROOT ?? "./artifacts/local",
  ) {}
  private get remote() {
    return serviceEndpoint("ARTIFACT");
  }
  path(key: string) {
    if (
      key.includes("\\") ||
      key.includes("\0") ||
      /(^|\/)auth\.json$/i.test(key) ||
      key.startsWith("/") ||
      normalize(key).startsWith("..")
    )
      throw new Error("Unsafe artifact key");
    const target = resolve(this.root, key),
      base = resolve(this.root);
    if (!target.startsWith(`${base}/`)) throw new Error("Unsafe artifact key");
    return target;
  }
  async put(key: string, data: Buffer | Uint8Array) {
    if (this.remote) {
      this.path(key);
      const response = await fetch(
        `${this.remote}/objects/${encodeURIComponent(key)}`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${signArtifactGrant({ key, operation: "write", maxBytes: data.byteLength || 1 })}`,
          },
          body: new Uint8Array(data),
          signal: AbortSignal.timeout(120_000),
        },
      );
      if (!response.ok)
        throw new Error(`Artifact upload failed (${response.status})`);
      return {
        key,
        checksum: sha256(Buffer.from(data)),
        size: data.byteLength,
      };
    }
    return this.putStream(
      key,
      Readable.from([data]),
      Math.max(1, data.byteLength),
    );
  }

  async exists(key: string) {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
  async putFile(key: string, source: string, maxBytes = 250 * 1024 * 1024) {
    const info = await stat(source);
    if (info.size > maxBytes) throw new Error("Artifact exceeds output budget");
    if (this.remote) {
      this.path(key);
      const response = await fetch(
        `${this.remote}/objects/${encodeURIComponent(key)}`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${signArtifactGrant({ key, operation: "write", maxBytes: Math.max(1, info.size) })}`,
          },
          body: Readable.toWeb(createReadStream(source)),
          duplex: "half",
          signal: AbortSignal.timeout(120_000),
        } as RequestInit,
      );
      if (!response.ok)
        throw new Error(`Artifact upload failed (${response.status})`);
      return (await response.json()) as {
        key: string;
        checksum: string;
        size: number;
      };
    }
    return this.putStream(
      key,
      createReadStream(source),
      Math.max(1, info.size),
    );
  }
  async putStream(key: string, source: Readable, maxBytes: number) {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    const hash = createHash("sha256");
    let size = 0;
    const counter = new Transform({
      transform(chunk, _encoding, done) {
        size += chunk.length;
        hash.update(chunk);
        done(
          size > maxBytes ? new Error("Artifact byte limit exceeded") : null,
          chunk,
        );
      },
    });
    try {
      await pipeline(
        source,
        counter,
        createWriteStream(temp, { flags: "wx", mode: 0o600 }),
      );
      const handle = await open(temp, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      const checksum = hash.digest("hex");
      const cas = this.path(`objects/sha256/${checksum}`);
      await mkdir(dirname(cas), { recursive: true });
      try {
        await link(temp, cas);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      try {
        await link(cas, target);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          (await hashFile(target)) !== checksum
        )
          throw new Error(`Immutable artifact conflict: ${key}`);
      }
      for (const directory of new Set([dirname(cas), dirname(target)])) {
        const parent = await open(directory, "r");
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      }
      return { key, checksum, size };
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }
  async materialize(key: string) {
    const path = this.path(key);
    if (!this.remote) return path;
    if (await this.exists(key)) return path;
    const response = await fetch(
      `${this.remote}/objects/${encodeURIComponent(key)}`,
      {
        headers: {
          authorization: `Bearer ${signArtifactGrant({ key, operation: "read", maxBytes: 250 * 1024 * 1024 })}`,
        },
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok || !response.body)
      throw new Error(`Artifact download failed (${response.status})`);
    await this.putStream(
      key,
      Readable.fromWeb(response.body as never),
      250 * 1024 * 1024,
    );
    return path;
  }
}
export function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}
export async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
