#!/usr/bin/env node
// Modified for the skilled TypeScript distribution.
/** Bridge the stateful Custom Engine contract to DSH's ACP profile. */
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  stat,
  realpath,
} from "node:fs/promises";
import { realpathSync, existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
export type JsonObject = Record<string, any>;
export const yamlString = (value: string): string => JSON.stringify(value);
export const safeSegment = (value: string, fallback: string): string =>
  value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") ||
  fallback;
export const outputText = (value: string | Buffer | null): string =>
  value === null ? "" : Buffer.isBuffer(value) ? value.toString("utf8") : value;
export function redactSecrets(value: string): string {
  for (const name of ["DSH_API_KEY", "DASHSCOPE_EVAL_API_KEY"]) {
    const secret = process.env[name];
    if (secret) value = value.replaceAll(secret, "[REDACTED]");
  }
  return value;
}
export function redactData(value: any): any {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactData);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [redactSecrets(k), redactData(v)]),
    );
  return value;
}
async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) result.push(...(await files(p)));
    else if ((await stat(p)).isFile()) result.push(p);
  }
  return result;
}
export async function sanitizeRunArtifacts(root: string): Promise<void> {
  const secrets = [
    ...new Set(
      ["DSH_API_KEY", "DASHSCOPE_EVAL_API_KEY"]
        .map((k) => process.env[k])
        .filter((v): v is string => !!v),
    ),
  ].map((v) => Buffer.from(v));
  if (!secrets.length) return;
  for (const p of await files(root)) {
    const original = await readFile(p);
    let value = original;
    for (const secret of secrets) {
      const parts: Buffer[] = [];
      let offset = 0,
        index: number;
      while ((index = value.indexOf(secret, offset)) >= 0) {
        parts.push(value.subarray(offset, index), Buffer.from("[REDACTED]"));
        offset = index + secret.length;
      }
      parts.push(value.subarray(offset));
      value = Buffer.concat(parts);
    }
    if (!value.equals(original)) await writeFile(p, value);
  }
}
export function terminateProcessTree(
  child: ChildProcessWithoutNullStreams,
): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
  }
}
export type AcpResult = [number, string, string, boolean, string, JsonObject[]];
class DeadlineError extends Error {}
export async function runDshAcp(
  command: string[],
  workspace: string,
  env: NodeJS.ProcessEnv,
  timeout: number,
  prompt: string,
  sessionId: string,
): Promise<AcpResult> {
  const child = spawn(command[0], command.slice(1), {
    cwd: workspace,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  await new Promise<void>((done, reject) => {
    child.once("spawn", done);
    child.once("error", reject);
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const closed = new Promise<number>((done) =>
    child.once("close", (code) => done(code ?? 1)),
  );
  const queue: (string | null)[] = [];
  let streamEnded = false;
  let pending: ((line: string | null) => void) | undefined;
  const push = (line: string | null) => {
    if (pending) {
      const take = pending;
      pending = undefined;
      take(line);
    } else queue.push(line);
  };
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  reader.on("line", (line) => push(line));
  reader.once("close", () => {
    streamEnded = true;
    push(null);
  });
  const deadline = performance.now() + timeout * 1000,
    frames: JsonObject[] = [];
  const writeFrame = (frame: JsonObject) => {
    frames.push({ direction: "client", frame: redactData(frame) });
    child.stdin.write(JSON.stringify(frame) + "\n");
  };
  // Broken pipes are reflected by EOF/close in the transport result.
  child.stdin.on("error", () => {});
  const nextLine = (method: string): Promise<string | null> => {
    const remaining = deadline - performance.now();
    if (remaining <= 0)
      return Promise.reject(
        new DeadlineError(`ACP request ${method} timed out`),
      );
    if (queue.length) return Promise.resolve(queue.shift()!);
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        pending = undefined;
        reject(new DeadlineError(`ACP request ${method} timed out`));
      }, remaining);
      pending = (line) => {
        clearTimeout(timer);
        done(line);
      };
    });
  };
  const messages = new Map<string, string[]>(),
    order: string[] = [];
  let requestId = 0,
    activeSession = sessionId;
  const finalMessage = () =>
    order.length ? messages.get(order.at(-1)!)!.join("") : "";
  const rpc = async (
    method: string,
    params: JsonObject,
  ): Promise<JsonObject> => {
    const id = ++requestId;
    writeFrame({ jsonrpc: "2.0", id, method, params });
    while (true) {
      const line = await nextLine(method);
      if (line === null)
        throw new Error(
          `DSH ACP exited before responding to ${method} (exit=${child.exitCode === null ? "None" : child.exitCode})`,
        );
      let frame: any;
      try {
        frame = JSON.parse(line);
      } catch {
        throw new Error(`DSH ACP emitted non-JSON stdout: ${line.trim()}`);
      }
      if (!frame || Array.isArray(frame) || typeof frame !== "object") continue;
      frames.push({ direction: "agent", frame: redactData(frame) });
      if (
        frame.method === "session/request_permission" &&
        Object.hasOwn(frame, "id")
      ) {
        const options = frame.params?.options || [];
        let selected: JsonObject | undefined;
        for (const kind of ["allow_always", "allow_once"]) {
          selected = options.find((o: JsonObject) => o.kind === kind);
          if (selected) break;
        }
        writeFrame({
          jsonrpc: "2.0",
          id: frame.id,
          result: {
            outcome: selected
              ? { outcome: "selected", optionId: selected.optionId }
              : { outcome: "cancelled" },
          },
        });
        continue;
      }
      if (frame.method === "session/update") {
        const update = frame.params?.update || {},
          content = update.content || {};
        if (
          update.sessionUpdate === "agent_message_chunk" &&
          content.type === "text"
        ) {
          const mid = String(update.messageId || "unidentified");
          if (!messages.has(mid)) {
            messages.set(mid, []);
            order.push(mid);
          }
          messages.get(mid)!.push(String(content.text || ""));
        }
        continue;
      }
      if (frame.id !== id) continue;
      if (frame.error != null) {
        const e = frame.error;
        let message = typeof e === "object" ? e.message : e;
        const details =
          typeof e === "object" && e.data && typeof e.data === "object"
            ? e.data.details
            : undefined;
        if (details && !String(message).includes(details))
          message = `${message}: ${details}`;
        throw new Error(`DSH ACP ${method} failed: ${message}`);
      }
      return frame.result &&
        typeof frame.result === "object" &&
        !Array.isArray(frame.result)
        ? frame.result
        : {};
    }
  };
  const openSession = async (
    method: string,
    params: JsonObject,
  ): Promise<JsonObject> => {
    let delay = 100;
    const ready = Math.min(deadline, performance.now() + 5000);
    while (true) {
      try {
        return await rpc(method, params);
      } catch (e) {
        if (
          !(e instanceof Error) ||
          !e.message.includes("no adapter registered for provider") ||
          performance.now() + delay >= ready
        )
          throw e;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 1000);
      }
    }
  };
  try {
    await rpc("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "skilled-dsh-runner", version: "1" },
    });
    if (activeSession)
      await openSession("session/resume", {
        sessionId: activeSession,
        cwd: workspace,
        mcpServers: [],
      });
    else {
      activeSession = String(
        (await openSession("session/new", { cwd: workspace, mcpServers: [] }))
          .sessionId || "",
      );
      if (!activeSession)
        throw new Error("DSH ACP session/new returned no sessionId");
    }
    await rpc("session/prompt", {
      sessionId: activeSession,
      prompt: [{ type: "text", text: prompt }],
    });
    await rpc("session/close", { sessionId: activeSession });
    child.stdin.end();
    let timer: NodeJS.Timeout | undefined;
    try {
      const code = await Promise.race([
        closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new DeadlineError("DSH ACP process exit timed out")),
            Math.max(100, deadline - performance.now()),
          );
        }),
      ]);
      return [code, finalMessage(), stderr, false, activeSession, frames];
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (streamEnded) {
      let settle: NodeJS.Timeout | undefined;
      await Promise.race([
        closed,
        new Promise<void>((done) => {
          settle = setTimeout(done, 50);
        }),
      ]);
      clearTimeout(settle);
    }
    terminateProcessTree(child);
    await closed;
    stderr += `\n${e instanceof Error ? e.message : String(e)}`;
    return [
      e instanceof DeadlineError ? 124 : 1,
      finalMessage(),
      stderr,
      e instanceof DeadlineError,
      activeSession,
      frames,
    ];
  } finally {
    reader.close();
  }
}
export function encodeSessionRef(run: string, session: string): string {
  const payload = JSON.stringify({ run, session }).replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `dsh1.${Buffer.from(payload).toString("base64url")}`;
}
export function decodeSessionRef(value: string): [string, string] {
  if (!value.startsWith("dsh1."))
    throw new Error("unsupported DSH session reference");
  const data = JSON.parse(
    Buffer.from(value.slice(5), "base64url").toString("utf8"),
  );
  const run = String(data.run || ""),
    session = String(data.session || "");
  if (safeSegment(run, "") !== run || !session)
    throw new Error("invalid DSH session reference");
  return [run, session];
}
export async function writeDshConfig(
  home: string,
  sessionRoot: string,
  skillsDir: string,
): Promise<void> {
  const model = process.env.DSH_MODEL ?? "qwen3.8-max",
    url =
      process.env.DSH_BASE_URL ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const patch = [
    "- id: agent-default-model",
    "  config:",
    "    provider: skilled-openai",
    `    model: ${yamlString(model)}`,
    "- id: acp",
    "  config:",
    "    provider: skilled-openai",
    `    model: ${yamlString(model)}`,
    "- id: session-persistence-jsonl",
    "  config:",
    `    root: ${yamlString(sessionRoot)}`,
    "    compression: none",
    "    packChunks: false",
    "- id: session-title-llm",
    "  disabled: true",
  ];
  let skills = false;
  try {
    skills = (await stat(skillsDir)).isDirectory();
  } catch {}
  if (skills)
    patch.push(
      "- id: skill-filesystem",
      "  config:",
      "    includeDefaultRoots: false",
      "    customSkillDirs:",
      `      - ${yamlString(skillsDir)}`,
    );
  await writeFile(join(home, "cordis.patch.yml"), patch.join("\n") + "\n");
  await writeFile(
    join(home, "settings.yaml"),
    [
      "llm-pi-ai:",
      "  providers:",
      "    skilled-openai:",
      "      apiKeyEnv: DSH_API_KEY",
      "      api: openai-completions",
      `      baseURL: ${yamlString(url)}`,
      "      models:",
      `        - id: ${yamlString(model)}`,
      "",
    ].join("\n"),
  );
}
export function transcript(
  messages: JsonObject[],
  finalMessage: string,
): JsonObject[] {
  const result: JsonObject[] = [];
  let turn = 1;
  for (const message of messages) {
    const role = String(message.role ?? "user");
    if (role === "user" && result.length) turn++;
    result.push({
      role,
      content: redactSecrets(String(message.content ?? "")),
      turn,
    });
  }
  result.push({ role: "assistant", content: finalMessage, turn });
  return result;
}
export function contentText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    if (block.type === "text" && block.text)
      parts.push(redactSecrets(String(block.text)));
    else if (block.type === "tool-result") {
      const nested = contentText(block.content);
      if (nested) parts.push(nested);
    }
  }
  return parts.join("\n");
}
export function parseArguments(raw: unknown): JsonObject {
  if (raw && typeof raw === "object" && !Array.isArray(raw))
    return redactData(raw);
  if (typeof raw !== "string" || !raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { _raw: redactSecrets(raw) };
  }
  return redactData(
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : { _raw: raw },
  );
}
export type SessionRead = [
  string,
  string,
  JsonObject[],
  number,
  number,
  number,
];
const object = (value: unknown): value is JsonObject =>
  !!value && typeof value === "object" && !Array.isArray(value);
export async function readSession(
  file: string | null,
  inputs: JsonObject[],
  finalMessage: string,
): Promise<SessionRead> {
  if (file === null)
    return ["", finalMessage, transcript(inputs, finalMessage), 0, 0, 1];
  let id = basename(file).replace(/\.[^.]*$/, ""),
    latest = 1;
  const records: JsonObject[] = [];
  for (const line of (await readFile(file, "utf8")).split(/\r?\n/)) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!object(event)) continue;
    if (event.type === "session") id = String(event.id || id);
    if (object(event.data))
      latest = Math.max(latest, Math.trunc(Number(event.data.turn || 1)));
    records.push(event);
  }
  const events: JsonObject[] = [];
  let inputTokens = 0,
    outputTokens = 0;
  for (const event of records) {
    const data = event.data;
    if (!object(data) || Math.trunc(Number(data.turn || 1)) !== latest)
      continue;
    if (["assistant/message", "assistant/attempt"].includes(event.type)) {
      let usage = data.usage || {};
      const message = data.message || {};
      let blocks = object(message) ? message.content : [];
      if (event.type === "assistant/attempt") {
        blocks = [];
        for (const item of data.stream || []) {
          if (!object(item) || item.type !== "chunk") continue;
          const chunk = item.chunk || {};
          if (!object(chunk)) continue;
          if (chunk.type === "usage") usage = chunk.usage || usage;
          else if (chunk.type === "block-end" && object(chunk.block))
            blocks.push(chunk.block);
        }
      }
      if (object(usage)) {
        inputTokens += [
          "inputTokens",
          "cacheReadTokens",
          "cacheWriteTokens",
        ].reduce((n, k) => n + Math.trunc(Number(usage[k] || 0)), 0);
        outputTokens += Math.trunc(Number(usage.outputTokens || 0));
      }
      for (const block of Array.isArray(blocks) ? blocks : []) {
        if (!object(block)) continue;
        if (block.type === "text" && block.text)
          events.push({
            role: "assistant",
            content: redactSecrets(String(block.text)),
            turn: 1,
          });
        else if (block.type === "tool-call")
          events.push({
            role: "tool_call",
            turn: 1,
            tool_call: {
              id: String(block.id || ""),
              name: String(block.name || ""),
              arguments: parseArguments(block.arguments),
            },
          });
      }
    } else if (event.type === "tool/result") {
      const message = data.message || {},
        blocks = object(message) ? message.content : [];
      for (const block of Array.isArray(blocks) ? blocks : []) {
        if (!object(block) || block.type !== "tool-result") continue;
        const content = contentText(block.content);
        events.push({
          role: "tool_result",
          turn: 1,
          content,
          tool_result: {
            call_id: String(block.toolCallId || ""),
            status: block.isError === true || data.error ? "error" : "success",
            content,
          },
        });
      }
    }
  }
  const normalized = transcript(inputs, "").slice(0, -1);
  if (!finalMessage)
    finalMessage = String(
      events.toReversed().find((e) => e.role === "assistant" && e.content)
        ?.content || "",
    );
  const combined = [...normalized, ...events];
  if (
    !combined.some(
      (e) =>
        e.role === "assistant" &&
        String(e.content || "").trim() === finalMessage,
    )
  )
    combined.push({ role: "assistant", content: finalMessage, turn: 1 });
  return [id, finalMessage, combined, inputTokens, outputTokens, 1];
}
export async function main(args = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { input: { type: "string" }, output: { type: "string" } },
    strict: true,
  });
  if (!values.input || !values.output)
    throw new Error("--input and --output are required");
  const request = JSON.parse(await readFile(values.input, "utf8"));
  const workspace = await realpath(resolve(request.workspace)),
    runs = join(workspace, ".skilled-dsh/runs");
  await mkdir(runs, { recursive: true });
  let run: string,
    dshSession = "";
  if (request.session_id)
    [run, dshSession] = decodeSessionRef(String(request.session_id));
  else
    run = [
      safeSegment(String(request.case_id ?? "case"), "case"),
      safeSegment(String(request.variant ?? "run"), "run"),
      randomUUID().replaceAll("-", "").slice(0, 12),
    ].join("-");
  const home = join(runs, run),
    sessionRoot = join(home, "sessions");
  await mkdir(sessionRoot, { recursive: true });
  await writeDshConfig(
    home,
    sessionRoot,
    process.env.DSH_SKILLS_DIR ?? join(workspace, ".dsh-skills"),
  );
  const messages = request.messages || [];
  if (messages.length !== 1 || messages[0].role !== "user")
    throw new Error(
      "stateful DSH runner expects exactly one user message per invocation",
    );
  const timeout = Number(request.timeout_seconds || 300),
    dshTimeout = Math.max(
      0.1,
      timeout - Math.min(5, Math.max(0.5, timeout * 0.1)),
    );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_TELEMETRY_MODE: process.env.DSH_TELEMETRY_MODE ?? "DISABLED",
    DSH_PERMISSION_MODE:
      process.env.DSH_PERMISSION_MODE ?? "danger-full-access",
  };
  const start = performance.now();
  const [exitCode, acpMessage, rawError, timedOut, activeSession, frames] =
    await runDshAcp(
      [env.DSH_BIN || "dsh", "--profile", "acp"],
      workspace,
      env,
      dshTimeout,
      String(messages[0].content ?? ""),
      dshSession,
    );
  let finalMessage = redactSecrets(outputText(acpMessage).trim()),
    stderr = redactSecrets(outputText(rawError));
  if (exitCode !== 0 && !stderr.trim()) stderr = finalMessage;
  if (timedOut) stderr += `\nDSH timed out after ${dshTimeout}s`;
  const duration = Math.trunc(performance.now() - start),
    invocation = randomUUID().replaceAll("-", "").slice(0, 12),
    stderrPath = join(home, `stderr-${invocation}.log`),
    protocolPath = join(home, `acp-${invocation}.jsonl`);
  await writeFile(stderrPath, stderr);
  await writeFile(
    protocolPath,
    frames.map((frame) => JSON.stringify(redactData(frame)) + "\n").join(""),
  );
  await sanitizeRunArtifacts(home);
  const sessionFile =
    (await files(sessionRoot))
      .filter((p) => p.endsWith(".jsonl"))
      .sort()
      .find((p) => basename(dirname(p)) === activeSession) || null;
  const artifacts = [
    join(home, "cordis.patch.yml"),
    join(home, "settings.yaml"),
    stderrPath,
    protocolPath,
    ...(sessionFile ? [sessionFile] : []),
  ];
  const [
    parsedId,
    parsedFinal,
    runTranscript,
    inputTokens,
    outputTokens,
    turns,
  ] = await readSession(sessionFile, messages, finalMessage);
  dshSession = parsedId || activeSession;
  finalMessage = parsedFinal;
  const result = {
    engine: "deepseek-harness",
    model: process.env.DSH_MODEL ?? "qwen3.8-max",
    session_id: dshSession ? encodeSessionRef(run, dshSession) : "",
    exit_code: exitCode,
    duration_ms: duration,
    turns,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    final_message: finalMessage,
    stderr: exitCode ? stderr : "",
    transcript: runTranscript,
    artifacts: {
      generated_files: artifacts.map((p) => relative(workspace, p)),
      logs: stderr,
    },
  };
  await mkdir(dirname(values.output), { recursive: true });
  await writeFile(values.output, JSON.stringify(result, null, 2) + "\n");
  return 0;
}
if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    process.exitCode = await main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
