import { ExecutionManifestSchema, serviceEndpoint } from "@skilled/core";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readdir, lstat, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ArtifactStore,
  createZip,
  extractZip,
  hashFile,
  signArtifactGrant,
} from "@skilled/core";
export const executionContext = new AsyncLocalStorage<Record<string, any>>();
export async function remoteExecution(
  cwd: string,
  operation: Record<string, unknown>,
  onDelta?: (text: string) => void,
) {
  const job = executionContext.getStore();
  if (!job) throw new Error("Remote execution requires a leased job context");
  const service = serviceEndpoint("EXECUTOR");
  const token = process.env.EXECUTOR_SERVICE_TOKEN;
  if (!service || !token) throw new Error("Executor service is not configured");
  const executionId = crypto.randomUUID();
  const store = new ArtifactStore();
  const zip = join(dirname(cwd), `${executionId}-input.zip`);
  const entries: string[] = [];
  let bytes = 0;
  async function walk(path: string, prefix = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || /(^|\/)auth\.json$/i.test(name))
        throw new Error("Unsafe execution input");
      if (entry.isDirectory()) await walk(join(path, entry.name), name);
      else if (entry.isFile()) {
        bytes += (await lstat(join(path, entry.name))).size;
        if (bytes > 500 * 1024 * 1024)
          throw new Error("Execution inputs exceed budget");
        entries.push(name);
      }
    }
  }
  await walk(cwd);
  await createZip(cwd, entries, zip);
  const inputKey = `executions/${executionId}/input.zip`;
  const outputKey = `executions/${executionId}/output.zip`;
  const inputChecksum = await hashFile(zip);
  await store.putFile(inputKey, zip, 512 * 1024 * 1024);
  await rm(zip, { force: true });
  const request = ExecutionManifestSchema.parse({
    executionId,
    jobId: job.id,
    leaseToken: Number(job.lease_token),
    resourceId: job.resource_id,
    adapter: job.adapter,
    inputKey,
    inputChecksum,
    inputGrant: signArtifactGrant({
      key: inputKey,
      operation: "read",
      maxBytes: 512 * 1024 * 1024,
    }),
    operation,
  });
  const call = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${service}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body:
        body === undefined
          ? undefined
          : JSON.stringify({
              ...(body as object),
              leaseToken: Number(job.lease_token),
            }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(
        `Executor request failed (${response.status}): ${(await response.text()).slice(0, 1000)}`,
      );
    return await response.json();
  };
  await call("/executions", "POST", request);
  let cursor = 0;
  let renewedAt = Date.now();
  const deadline = Date.now() + 2 * 60 * 60_000;
  try {
    while (Date.now() < deadline) {
      const result = await call(`/executions/${executionId}?cursor=${cursor}`);
      for (const event of result.events ?? []) {
        if (event.sequence > cursor) {
          cursor = event.sequence;
          onDelta?.(event.text);
        }
      }
      const terminal = [
        "completed",
        "failed",
        "interrupted",
        "cancelled",
      ].includes(result.status);
      if (terminal) {
        if (operation.kind === "skillup" && result.outputAvailable) {
          // Grant is issued after completion so long jobs do not hold expired upload grants.
          await call(`/executions/${executionId}/publish`, "POST", {
            key: outputKey,
            grant: signArtifactGrant({
              key: outputKey,
              operation: "write",
              maxBytes: 250 * 1024 * 1024,
            }),
          });
          const output = join(cwd, "skill-up-output");
          await mkdir(output, { recursive: true });
          await extractZip(await store.materialize(outputKey), output, {
            requireSkill: false,
            internalTransfer: true,
          });
        }
        if (!result.result)
          throw new Error(result.error ?? `Execution ${result.status}`);
        return result.result;
      }
      if (Date.now() - renewedAt >= 10_000) {
        await call(`/executions/${executionId}/renew`, "POST", {});
        renewedAt = Date.now();
      }
      if (job.signal?.aborted) {
        await call(`/executions/${executionId}/cancel`, "POST", {});
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Remote execution exceeded job time budget");
  } catch (error) {
    await call(`/executions/${executionId}/cancel`, "POST", {}).catch(
      () => undefined,
    );
    throw error;
  }
}
