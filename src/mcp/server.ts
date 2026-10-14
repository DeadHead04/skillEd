// Modified for the skilled TypeScript distribution.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { mkdir, readFile, realpath, stat, readdir } from "node:fs/promises";
import { runMcpCli } from "./process.js";
export { runMcpCli } from "./process.js";
import { startJob, readJob, cancelJob, reportFiles, jobId } from "./jobs.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../brand.js";
import {
  Loader,
  validateAll,
  resolveCustomEngineConfig,
} from "../config/index.js";
import { validateSkillSource } from "../skill/integrity.js";
import { compareResults, parseComparisonInput } from "../report/compare.js";
import { setOutput as setLogOutput } from "../logging/index.js";
import { setOutput as setUIOutput } from "../ui/index.js";

const maxResponseBytes = 64 * 1024;
const maxFileBytes = 4 * 1024 * 1024;
const workflowUri = "skilled://workflow/skilled-improve";
const workflowFile = fileURLToPath(
  new URL(
    "../../bundled-plugins/codex-skilled/skills/skilled-improve/SKILL.md",
    import.meta.url,
  ),
);
async function workflowResources() {
  const root = await realpath(path.dirname(workflowFile));
  const entries = new Map([
    [
      workflowUri,
      {
        file: await confined(root, workflowFile),
        name: "skilled-improve",
        mimeType: "text/markdown",
      },
    ],
  ]);
  async function visit(directory: string) {
    for (const item of await readdir(path.join(root, directory), {
      withFileTypes: true,
    })) {
      const relative = path.posix.join(directory, item.name);
      if (item.isDirectory()) await visit(relative);
      else if (item.isFile())
        entries.set(
          `${workflowUri}/${relative.split("/").map(encodeURIComponent).join("/")}`,
          {
            file: await confined(root, path.join(root, relative)),
            name: relative,
            mimeType: relative.endsWith(".md") ? "text/markdown" : "text/plain",
          },
        );
    }
  }
  await visit("references");
  await visit("assets");
  return entries;
}
export interface McpOptions {
  workspace: string;
  allowExecution?: boolean;
  signal?: AbortSignal;
}
function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(".." + path.sep))
  );
}
/** Resolve existing files through symlinks; a selected workspace is not an execution sandbox. */
async function confined(root: string, value: string): Promise<string> {
  const candidate = path.resolve(root, value);
  const resolved = await realpath(candidate);
  if (!inside(root, resolved))
    throw new Error("Path or symlink points outside the MCP workspace");
  return resolved;
}
async function outputDirectory(root: string, value: string): Promise<string> {
  const candidate = path.resolve(root, value);
  let ancestor = candidate;
  for (;;) {
    try {
      await confined(root, ancestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  if (
    (await realpath(ancestor)) === root &&
    path.relative(ancestor, candidate) === ""
  )
    throw new Error("Report directory must be a child of the MCP workspace");
  await mkdir(candidate, { recursive: true });
  const resolved = await confined(root, candidate);
  if (resolved === root)
    throw new Error("Report directory must be a child of the MCP workspace");
  return resolved;
}
async function readBounded(file: string): Promise<string> {
  const info = await stat(file);
  if (!info.isFile() || info.size > maxFileBytes)
    throw new Error("Expected a regular file no larger than 4 MiB");
  const data = await readFile(file);
  if (data.byteLength > maxFileBytes)
    throw new Error("File exceeds the 4 MiB read limit");
  return data.toString("utf8");
}
function bounded(text: string, bytes = maxResponseBytes): string {
  const data = Buffer.from(text);
  if (data.length <= bytes) return text;
  const notice =
    "\n[Response truncated; inspect the local files for full details.]";
  // Reserve three bytes for a possible UTF-8 replacement character at the cut.
  return (
    data
      .subarray(0, Math.max(0, bytes - Buffer.byteLength(notice) - 3))
      .toString("utf8") + notice
  );
}
function response(value: unknown, isError = false) {
  return {
    isError,
    content: [
      {
        type: "text" as const,
        text: bounded(
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
        ),
      },
    ],
  };
}
const properties = {
  path: {
    type: "string",
    minLength: 1,
    description: "Path relative to the selected MCP workspace.",
  },
};
const tools: Tool[] = [
  {
    name: "skilled_validate_skill",
    description:
      "Read-only validation of SKILL.md metadata and its local references. Does not execute the skill.",
    inputSchema: {
      type: "object",
      properties,
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "skilled_validate",
    description:
      "Read-only validation of an eval.yaml and its case files. Does not invoke models or scripts.",
    inputSchema: {
      type: "object",
      properties,
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "skilled_compare",
    description:
      "Compare two local result.json reports and identify case regressions and improvements without running evaluations.",
    inputSchema: {
      type: "object",
      properties: { before: properties.path, after: properties.path },
      required: ["before", "after"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "skilled_run",
    description:
      "Validate/list cases by default (dryRun:true). Set dryRun:false to execute a trusted evaluation when the server was started with --allow-execution. Execution can run local commands and scripts, access the network, and spend model-provider credits using the host's existing configuration and credentials. Workspace path checks are not a sandbox. Set provider-side spending limits; this tool enforces a time limit, not a currency budget. Cancellation stops the CLI and requests runtime cleanup. Reports remain in outputDir.",
    inputSchema: {
      type: "object",
      properties: {
        path: properties.path,
        dryRun: { type: "boolean", default: true },
        outputDir: {
          type: "string",
          minLength: 1,
          description:
            "Report base directory within the workspace. Each run gets a private child directory; defaults to .skilled-mcp/runs.",
        },
        timeoutSeconds: {
          type: "integer",
          minimum: 1,
          maximum: 3600,
          default: 300,
        },
        model: { type: "string", minLength: 1 },
        provider: { type: "string", minLength: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
];
// Async execution is explicit: synchronous cancellation semantics remain compatible.
const runProperties = tools.find(tool => tool.name === "skilled_run")!.inputSchema.properties!;
const { dryRun: _dryRun, ...startProperties } = runProperties;
tools.push({
  name: "skilled_start",
  description: "Start a trusted evaluation as a persistent background job. Requires --allow-execution. Returns a runId; use skilled_status/results/cancel. Survives client disconnection and MCP server shutdown. Reuse the same idempotencyKey and arguments to recover a run without duplicate execution; use a new key for an intentional rerun. Each distinct key starts an independent job and can spend model credits. Workspace checks are not a command sandbox.",
  inputSchema: { type: "object", properties: { ...startProperties, idempotencyKey: { type: "string", minLength: 1, description: "Stable request identifier (1–128 characters), reused when reconnecting." } }, required: ["path", "idempotencyKey"], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
});
for (const name of ["skilled_status", "skilled_results", "skilled_cancel"]) tools.push({
  name,
  description: name === "skilled_cancel" ? "Request cancellation of a persistent evaluation. Requires --allow-execution. Poll skilled_status until terminal cleanup completes." : "Read persistent run state and report locations by workspace-scoped runId. Does not start or repeat evaluation. Interrupted workers are reported explicitly.",
  inputSchema: { type: "object", properties: { runId: { type: "string", minLength: 1 } }, required: ["runId"], additionalProperties: false },
  annotations: { readOnlyHint: name !== "skilled_cancel", destructiveHint: name === "skilled_cancel", openWorldHint: false },
});
// The low-level MCP server validates protocol messages; validate each tool's own arguments as well.
function argumentsFor(
  name: string,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  const schema = tool.inputSchema;
  for (const key of schema.required ?? [])
    if (!Object.hasOwn(value, key))
      throw new Error(`Missing required argument: ${key}`);
  for (const [key, input] of Object.entries(value)) {
    if (!schema.properties || !Object.hasOwn(schema.properties, key))
      throw new Error(`Unknown argument: ${key}`);
    const rule = schema.properties?.[key] as
      | { type: string; minLength?: number; minimum?: number; maximum?: number }
      | undefined;
    if (!rule) throw new Error(`Unknown argument: ${key}`);
    if (
      rule.type === "string" &&
      (typeof input !== "string" ||
        input.length < (rule.minLength ?? 0) ||
        input.includes("\0"))
    )
      throw new Error(`${key} must be a nonempty string without NUL bytes`);
    if (rule.type === "boolean" && typeof input !== "boolean")
      throw new Error(`${key} must be a boolean`);
    if (
      rule.type === "integer" &&
      (typeof input !== "number" ||
        !Number.isInteger(input) ||
        input < (rule.minimum ?? 0) ||
        input > (rule.maximum ?? Infinity))
    )
      throw new Error(`${key} is outside its supported integer range`);
  }
  return value;
}
async function evaluation(root: string, input: string) {
  let file = await confined(root, input);
  if ((await stat(file)).isDirectory())
    file = await confined(root, path.join(file, "evals/eval.yaml"));
  await readBounded(file);
  const loader = await Loader.create(file);
  await confined(root, loader.skillDir);
  const config = await loader.loadEvalConfig();
  for (const name of config.cases.files)
    await readBounded(
      await confined(root, path.resolve(loader.skillDir, name)),
    );
  const loaded = { eval: config, cases: await loader.loadAllCases(config) };
  validateAll(loaded);
  resolveCustomEngineConfig(config);
  return { file, loaded };
}
export async function createMcpServer(
  options: McpOptions,
): Promise<Server & { waitForIdle: () => Promise<void> }> {
  const active = new Set<Promise<unknown>>();
  const workspace = await realpath(options.workspace);
  if (!(await stat(workspace)).isDirectory())
    throw new Error("MCP workspace must be a directory");
  const resources = await workflowResources();
  const server = new Server(
    { name: "skilled", version: VERSION },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions:
        "Use skilled-improve for a review-driven skill evaluation workflow. Validate before running. Execution requires an explicitly enabled server; do not pass credentials as tool arguments. Paths are relative to the selected workspace.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [...resources].map(([uri, resource]) => ({
      uri,
      name: resource.name,
      mimeType: resource.mimeType,
      description: "Bundled skill improvement workflow material",
    })),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.get(request.params.uri);
    if (!resource) throw new Error("Unknown resource URI");
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: resource.mimeType,
          text: bounded(await readBounded(resource.file)),
        },
      ],
    };
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "skilled-improve",
        description:
          "Review a skill, preserve a baseline, evaluate changes and compare reports using the bundled workflow.",
      },
    ],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name !== "skilled-improve")
      throw new Error("Unknown prompt");
    return {
      description: "skilled-improve workflow",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "MCP usage: workflow references and templates are available as resources under skilled://workflow/skilled-improve/ (for example references/cli.md and assets/eval.yaml.tmpl). Use skilled_validate_skill, skilled_validate, skilled_run, skilled_start, skilled_status, skilled_results, skilled_cancel and skilled_compare for the corresponding CLI operations. Tool paths are relative to the configured workspace. skilled_run defaults to validation only; synchronous execution needs dryRun:false and an execution-enabled server. Prefer skilled_start for long evaluations, then poll skilled_status and retrieve skilled_results. Reuse the same idempotencyKey to recover a run after reconnecting.\n\n" +
              bounded(await readBounded(workflowFile)),
          },
        },
      ],
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const args = argumentsFor(
        request.params.name,
        request.params.arguments ?? {},
      );
      const signal = options.signal
        ? AbortSignal.any([options.signal, extra.signal])
        : extra.signal;
      signal.throwIfAborted();
      switch (request.params.name) {
        case "skilled_validate_skill":
          return response(
            await validateSkillSource(
              await confined(workspace, args.path as string),
            ),
          );
        case "skilled_compare":
          return response(
            compareResults(
              parseComparisonInput(
                await readBounded(
                  await confined(workspace, args.before as string),
                ),
              ),
              parseComparisonInput(
                await readBounded(
                  await confined(workspace, args.after as string),
                ),
              ),
            ),
          );
        case "skilled_validate": {
          const { file, loaded } = await evaluation(
            workspace,
            args.path as string,
          );
          return response({
            valid: true,
            path: path.relative(workspace, file),
            cases: loaded.cases.map((item) => item.id),
            engine: loaded.eval.engine.name,
          });
        }
        case "skilled_status":
        case "skilled_results":
        case "skilled_cancel": {
          if (request.params.name === "skilled_cancel" && !options.allowExecution)
            throw new Error("Execution is disabled. Start skilled mcp with --allow-execution to cancel a run.");
          const root = await confined(workspace, ".skilled-mcp/jobs");
          return response(await (request.params.name === "skilled_cancel" ? cancelJob : readJob)(root, args.runId as string));
        }
        case "skilled_start":
        case "skilled_run": {
          const asynchronous = request.params.name === "skilled_start";
          const dryRun = !asynchronous && args.dryRun !== false;
          if (!dryRun && !options.allowExecution)
            throw new Error(
              "Execution is disabled. Start skilled mcp with --allow-execution to run trusted evaluations, or use dryRun:true to validate and list cases.",
            );
          const { file, loaded } = await evaluation(
            workspace,
            args.path as string,
          );
          if (dryRun)
            return response({
              dryRun: true,
              cases: loaded.cases.map((item) => item.id),
              engine: loaded.eval.engine.name,
              message: "Validated only; no scripts or models were executed.",
            });
          signal.throwIfAborted();
          const outputBase = await outputDirectory(
            workspace,
            (args.outputDir as string | undefined) ?? ".skilled-mcp/runs",
          );
          // Private run namespaces cannot overlap, even when independent clients
          // request identical or nested base directories. Resolve symlinks first.
          if (path.relative(workspace, outputBase).split(path.sep).includes(".skilled-runs"))
            throw new Error("outputDir cannot be inside an existing MCP run directory; choose a report base directory");
          const expectedOutputDir = path.join(outputBase, ".skilled-runs", asynchronous ? jobId(args.idempotencyKey as string) : randomUUID());
          const outputDir = await outputDirectory(workspace, expectedOutputDir);
          if (outputDir !== expectedOutputDir)
            throw new Error("MCP run directories must not redirect through symlinks; choose a report base directory without a linked .skilled-runs namespace");
          const argv = [
            "run",
            file,
            "--output-dir",
            outputDir,
          ];
          // JSON is needed for comparison; preserve all user-selected reports.
          for (const format of new Set(["json", ...loaded.eval.report.formats]))
            argv.push("--format", format);
          if (args.model) argv.push("--model", args.model as string);
          if (args.provider) argv.push("--provider", args.provider as string);
          if (asynchronous) {
            const root = await outputDirectory(workspace, ".skilled-mcp/jobs");
            return response(await startJob(root, args.idempotencyKey as string, {
              workspace, argv, outputDir,
              timeoutSeconds: (args.timeoutSeconds as number | undefined) ?? 300,
            }));
          }
          if (active.size)
            throw new Error(
              "An evaluation is already running. Wait for it to finish or cancel it before starting another.",
            );
          const run = runMcpCli(
            argv,
            workspace,
            signal,
            (args.timeoutSeconds as number | undefined) ?? 300,
          );
          active.add(run);
          try {
            const result = await run;
            return response(
              { ...result, outputDir: path.relative(workspace, outputDir), ...await reportFiles(workspace, outputDir) },
              result.exitCode !== 0,
            );
          } finally {
            active.delete(run);
          }
        }
        default:
          throw new Error("Unknown tool");
      }
    } catch (error) {
      return response(
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
  });
  return Object.assign(server, {
    waitForIdle: async () => {
      await Promise.allSettled([...active]);
    },
  });
}
/** Serve one stdio connection, keeping all diagnostic output away from protocol stdout. */
export async function serveMcp(options: McpOptions): Promise<void> {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const restoreLog = setLogOutput(process.stderr),
    restoreUI = setUIOutput(process.stderr);
  let server: Awaited<ReturnType<typeof createMcpServer>> | undefined;
  try {
    server = await createMcpServer({ ...options, signal });
    const connectedServer = server;
    let detach = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        let closing = false;
        const shutdown = () => {
          if (closing) return;
          closing = true;
          detach();
          controller.abort();
          void connectedServer.close()
            .then(() => connectedServer.waitForIdle()).then(resolve, reject);
        };
        detach = () => {
          signal.removeEventListener("abort", shutdown);
          process.stdin.removeListener("end", shutdown);
          process.stdin.removeListener("close", shutdown);
        };
        connectedServer.onerror = (error) => {
          process.stderr.write(`skilled MCP: ${bounded(error.message, 2048)}\n`);
        };
        connectedServer.onclose = shutdown;
        signal.addEventListener("abort", shutdown, { once: true });
        process.stdin.once("end", shutdown);
        process.stdin.once("close", shutdown);
        if (signal.aborted || process.stdin.readableEnded) { shutdown(); return; }
        void connectedServer.connect(new StdioServerTransport()).catch(reject);
      });
    } finally {
      detach();
    }
  } finally {
    controller.abort();
    await server?.close();
    await server?.waitForIdle();
    restoreUI();
    restoreLog();
  }
}
