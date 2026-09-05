if (process.env.DATABASE_URL || process.env.ARTIFACT_SIGNING_KEY)
  throw new Error(
    "Artifact service must not receive database or signing credentials",
  );
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import {
  ArtifactStore,
  verifyArtifactGrant,
  requireStorage,
} from "@skilled/core";
if (!process.env.ARTIFACT_VERIFY_KEY)
  throw new Error("ARTIFACT_VERIFY_KEY required");
if (process.env.ARTIFACT_SERVICE_URL)
  throw new Error("Artifact service must use local storage");
const store = new ArtifactStore();
await mkdir(store.root, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    if (request.url === "/health") {
      response.end(
        JSON.stringify({
          status: "ready",
          storage: await requireStorage(store.root, 0),
        }),
      );
      return;
    }
    if (!request.url?.startsWith("/objects/")) {
      response.writeHead(404).end();
      return;
    }
    const key = decodeURIComponent(request.url.slice("/objects/".length));
    const operation =
      request.method === "GET"
        ? "read"
        : request.method === "PUT"
          ? "write"
          : null;
    if (!operation) {
      response.writeHead(405).end();
      return;
    }
    const grant = verifyArtifactGrant(
      request.headers.authorization?.replace(/^Bearer /, "") ?? "",
      key,
      operation,
    );
    if (operation === "write") {
      await requireStorage(store.root);
      const saved = await store.putStream(
        key,
        request,
        Math.min(
          grant.maxBytes,
          /^executions\/[a-f0-9-]+\/input\.zip$/.test(key)
            ? 512 * 1024 * 1024
            : 250 * 1024 * 1024,
        ),
      );
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(saved));
    } else {
      const path = store.path(key);
      const info = await stat(path);
      if (info.size > grant.maxBytes)
        throw new Error("Read grant byte limit exceeded");
      response.setHeader("content-type", "application/octet-stream");
      response.setHeader("content-length", info.size);
      await pipeline(createReadStream(path), response);
    }
  } catch (error) {
    if (!response.headersSent)
      response.writeHead(
        (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 403,
      );
    response.end(JSON.stringify({ error: "Artifact request rejected" }));
  }
});
server.requestTimeout = 120_000;
server.listen(Number(process.env.PORT ?? 10000), "0.0.0.0");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
