import {
  ExecutionManifestSchema,
  serviceEndpoint,
  requireStorage,
  cleanWorkspaces,
} from "@skilled/core";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  open,
  lstat,
} from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { Readable } from "node:stream";
import {
  ArtifactStore,
  extractZip,
  hashFile,
  createZip,
  sha256,
} from "@skilled/core";
import { codexAppServer } from "./app-server.js";
import { executeBounded, stopExecutions } from "./process.js";
import {
  realExecutionReady,
  requireExecutionReady,
  executionReadiness,
} from "./readiness.js";
import { z } from "zod";
const Input = ExecutionManifestSchema;
const token = process.env.EXECUTOR_SERVICE_TOKEN;
const artifactUrl = serviceEndpoint("ARTIFACT");
if (!token || !artifactUrl)
  throw new Error("Executor service authentication and artifact URL required");
if (process.env.DATABASE_URL || process.env.ARTIFACT_SIGNING_KEY)
  throw new Error(
    "Executor must not receive database or artifact signing credentials",
  );
delete process.env.ARTIFACT_SERVICE_URL;
delete process.env.ARTIFACT_SERVICE_HOSTPORT; // This service uses grants supplied by the controller, never a broad storage client.
const root = process.env.EXECUTOR_STATE_ROOT ?? "/data/executor";
await mkdir(join(root, "records"), { recursive: true });
let active: string | null = null,
  stopping = false;
const records = new Map<string, any>();
let publication = Promise.resolve();
async function save(record: any) {
  const bytes = JSON.stringify(record);
  publication = publication
    .catch(() => undefined)
    .then(async () => {
      const path = join(root, "records", `${record.id}.json`),
        temp = `${path}.${crypto.randomUUID()}.tmp`;
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, path);
      const parent = await open(join(root, "records"), "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    });
  return publication;
}
function appendEvent(record: any, text: string) {
  record.eventBytes = (record.eventBytes ?? 0) + Buffer.byteLength(text);
  if (record.eventBytes > 10 * 1024 * 1024) {
    record.cancelRequested = true;
    record.error = "Execution event limit exceeded";
    stopExecutions();
    void codexAppServer.stop();
    return;
  }
  record.events.push({ sequence: record.events.length + 1, text });
}

for (const file of await readdir(join(root, "records"))) {
  if (!/^[a-f0-9-]+\.json$/.test(file)) continue;
  const record = JSON.parse(
    await readFile(join(root, "records", file), "utf8"),
  );
  if (record.status === "running") {
    record.status = "interrupted";
    record.error = "Executor replaced during execution";
    await save(record);
  }
  records.set(record.id, record);
}
function contained(base: string, name: string) {
  const path = resolve(base, name);
  if (relative(base, path).startsWith("..") || path === base)
    throw new Error("Execution path escape");
  return path;
}
async function execute(input: z.infer<typeof Input>, record: any) {
  const work = join(root, "work", input.executionId);
  await mkdir(work, { recursive: true });
  try {
    await requireExecutionReady();
    await requireStorage(root);
    const download = await fetch(
      `${artifactUrl}/objects/${encodeURIComponent(input.inputKey)}`,
      {
        headers: { authorization: `Bearer ${input.inputGrant}` },
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!download.ok || !download.body)
      throw new Error("Input artifact is unavailable");
    const cache = new ArtifactStore(join(root, "cache"));
    await cache.putStream(
      input.inputKey,
      Readable.fromWeb(download.body as never),
      512 * 1024 * 1024,
    );
    const archive = cache.path(input.inputKey);
    if ((await hashFile(archive)) !== input.inputChecksum)
      throw new Error("Input artifact checksum mismatch");
    await extractZip(archive, work, {
      requireSkill: false,
      internalTransfer: true,
    });
    if (input.operation.kind === "appServer") {
      const op = input.operation;
      record.result = await codexAppServer.structuredTurn(
        work,
        op.prompt,
        op.outputSchema,
        op.threadId,
        {
          recoveryContext: op.recoveryContext,
          skill: op.skillPath
            ? { name: "skill-upper", path: contained(work, op.skillPath) }
            : undefined,
          onDelta: (text) => {
            appendEvent(record, text);
          },
        },
      );
    } else {
      const op = input.operation;
      const output = join(work, "skill-up-output");
      await mkdir(output, { recursive: true });
      const args = [
        "run",
        contained(work, op.evalPath),
        "--engine",
        "codex",
        "--model",
        op.model,
        "--runtime",
        "none",
        "--parallelism",
        "1",
        "--iteration",
        String(op.iterations),
        "--output-dir",
        output,
        "--format",
        "json",
        "--format",
        "html",
      ];
      if (op.baseline) args.push("--baseline");
      for (const id of op.selectedCaseIds) args.push("--include-case-name", id);
      record.result = await executeBounded(
        process.env.SKILL_UP_BIN ?? "skill-up",
        args,
        {
          cwd: work,
          cancelled: async () => record.cancelRequested,
          onStdout: (text) => {
            appendEvent(record, text);
          },
        },
      );
      const entries: string[] = [];
      let collectedBytes = 0;
      async function walk(path: string, prefix = "") {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          const name = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isSymbolicLink() || /(^|\/)auth\.json$/i.test(name))
            continue;
          if (entry.isDirectory()) await walk(join(path, entry.name), name);
          else if (entry.isFile()) {
            const size = (await lstat(join(path, entry.name))).size;
            if (collectedBytes + size > 250 * 1024 * 1024) {
              record.result.outputLimited = true;
              continue;
            }
            collectedBytes += size;
            entries.push(name);
          }
        }
      }
      await walk(output);
      await createZip(output, entries, join(work, "outputs.zip"));
      record.outputAvailable = true;
    }
    record.status = record.cancelRequested ? "cancelled" : "completed";
  } catch (error) {
    record.status = record.cancelRequested ? "cancelled" : "failed";
    record.error = String(error);
  } finally {
    await save(record);
    active = null;
  }
}
const janitor = setInterval(() => {
  // Keep durable execution records for idempotency; only temporary input/output work expires.
  void cleanWorkspaces(join(root, "work"), active ? [active] : []).catch(
    () => undefined,
  );
  void cleanWorkspaces(
    join(root, "cache", "executions"),
    active ? [active] : [],
  ).catch(() => undefined);
}, 60 * 60_000);
const eventJournal = setInterval(() => {
  const record = active ? records.get(active) : undefined;
  if (record)
    void save(record).catch(() => {
      record.cancelRequested = true;
      record.error = "Execution state could not be persisted";
      stopExecutions();
    });
}, 1000);
const leaseWatch = setInterval(() => {
  const record = active ? records.get(active) : null;
  if (
    record &&
    record.leaseExpiresAt <= Date.now() &&
    !record.cancelRequested
  ) {
    record.cancelRequested = true;
    record.error = "Controller lease expired";
    stopExecutions();
    void codexAppServer.stop();
  }
}, 1000);
const server = createServer(async (request, response) => {
  const send = (status: number, data: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(data));
  };
  try {
    if (request.url === "/health") {
      send(200, {
        status: stopping ? "draining" : "alive",
        execution: (await realExecutionReady()) ? "ready" : "blocked",
      });
      return;
    }
    const supplied = Buffer.from(
      request.headers.authorization?.replace(/^Bearer /, "") ?? "",
    );
    const expected = Buffer.from(token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      send(401, { error: "Unauthorized" });
      return;
    }
    const url = new URL(request.url ?? "/", "http://executor");
    if (request.method === "GET" && url.pathname === "/readiness") {
      send(200, await executionReadiness());
      return;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    let body: any;
    if (request.method === "POST") {
      let bytes = "";
      for await (const chunk of request) {
        bytes += chunk;
        if (Buffer.byteLength(bytes) > 1_000_000)
          throw new Error("Request too large");
      }
      body = bytes ? JSON.parse(bytes) : {};
    }
    if (
      request.method === "POST" &&
      parts.length === 1 &&
      parts[0] === "executions"
    ) {
      const input = Input.parse(body);
      const fingerprint = sha256(
        JSON.stringify({ ...input, inputGrant: undefined }),
      );
      const prior = records.get(input.executionId);
      if (prior) {
        send(prior.fingerprint === fingerprint ? 200 : 409, {
          status: prior.status,
          executionId: prior.id,
        });
        return;
      }
      if (stopping || active) {
        send(409, { error: "Executor is busy or draining" });
        return;
      }
      await requireExecutionReady();
      const record = {
        id: input.executionId,
        jobId: input.jobId,
        leaseToken: input.leaseToken,
        fingerprint,
        manifest: { ...input, inputGrant: undefined },
        status: "running",
        events: [],
        createdAt: new Date().toISOString(),
        leaseExpiresAt: Date.now() + 60_000,
      };
      records.set(record.id, record);
      active = record.id;
      await save(record);
      void execute(input, record);
      send(202, { executionId: record.id });
      return;
    }
    const record =
      parts[0] === "executions" ? records.get(parts[1] ?? "") : undefined;
    if (!record) {
      send(404, { error: "Execution not found" });
      return;
    }
    if (
      request.method === "POST" &&
      Number(body.leaseToken) !== record.leaseToken
    ) {
      send(409, { error: "Stale execution owner" });
      return;
    }
    if (parts[2] === "renew" && request.method === "POST") {
      if (record.leaseExpiresAt <= Date.now() || record.status !== "running") {
        send(409, { error: "Execution lease expired or terminal" });
        return;
      }
      record.leaseExpiresAt = Date.now() + 60_000;
      await save(record);
      send(200, { status: record.status });
      return;
    }
    if (request.method === "GET") {
      send(200, {
        ...record,
        events: record.events
          .filter(
            (event: any) =>
              event.sequence > Number(url.searchParams.get("cursor") ?? 0),
          )
          .slice(0, 250),
      });
      return;
    }
    if (parts[2] === "cancel") {
      record.cancelRequested = true;
      if (active === record.id) {
        stopExecutions();
        await codexAppServer.stop();
      }
      await save(record);
      send(200, { status: record.status });
      return;
    }
    if (
      parts[2] === "publish" &&
      record.outputAvailable &&
      record.status !== "running"
    ) {
      const expectedKey = `executions/${record.id}/output.zip`;
      if (body.key !== expectedKey)
        throw new Error("Output object does not match execution");
      const { createReadStream } = await import("node:fs");
      const upload = await fetch(
        `${artifactUrl}/objects/${encodeURIComponent(expectedKey)}`,
        {
          method: "PUT",
          headers: { authorization: `Bearer ${body.grant}` },
          body: Readable.toWeb(
            createReadStream(join(root, "work", record.id, "outputs.zip")),
          ),
          duplex: "half",
          signal: AbortSignal.timeout(120_000),
        } as RequestInit,
      );
      if (!upload.ok) throw new Error("Output upload failed");
      send(200, await upload.json());
      return;
    }
    send(405, { error: "Unsupported operation" });
  } catch (error) {
    send(400, { error: String(error) });
  }
});
server.listen(Number(process.env.PORT ?? 10000), "0.0.0.0");
process.on("SIGTERM", () => {
  stopping = true;
  clearInterval(janitor);
  clearInterval(leaseWatch);
  clearInterval(eventJournal);
  stopExecutions();
  void codexAppServer.stop();
  server.close();
  setTimeout(() => {
    stopExecutions("SIGKILL");
    process.exit(0);
  }, 10_000);
});
