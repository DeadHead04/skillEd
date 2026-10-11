#!/usr/bin/env node
// Modified for the skilled TypeScript distribution.
/** Local observation runtime. Direct translation of the pinned observer protocol. */
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
// JSON object shapes are validated at the protocol boundary, as in the source.
export type JsonObject = Record<string, any>;
export const SCHEMA_VERSION = "v1alpha1";
export const PLUGIN_NAME = "codex-skilled";
export const OBSERVATION_DATA_NAME = "skilled-observer";
const CONTROL = new Set([
  PLUGIN_NAME,
  OBSERVATION_DATA_NAME,
  "skilled-improve",
]);
const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const OBSERVATION_ID = /^obs_[a-f0-9]{24}$/;
const SENTIMENTS = new Set(["", "positive", "negative", "mixed", "neutral"]);
const RULES: [string, RegExp][] = [
  ["bearer_token", /\bbearer\s+[a-z0-9._~+/=-]{12,}/gi],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  [
    "provider_key",
    /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g,
  ],
  ["aws_access_key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  [
    "secret_assignment",
    /\b(?:[A-Za-z_][A-Za-z0-9_]*_)?(?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;'"`]+)/gi,
  ],
];
export const utcNow = () => new Date().toISOString();
const expand = (p: string) =>
  p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
export function dataDir(): string {
  return process.env.SKILLED_OBSERVER_DATA
    ? resolve(expand(process.env.SKILLED_OBSERVER_DATA))
    : join(
        resolve(expand(process.env.CODEX_HOME || join(homedir(), ".codex"))),
        "plugin-data",
        OBSERVATION_DATA_NAME,
      );
}
export function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {}
}
export function redact(value: unknown): [string, string[]] {
  let text = value == null ? "" : String(value);
  const categories: string[] = [];
  for (const [name, pattern] of RULES) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      text = text.replace(pattern, "[REDACTED]");
      categories.push(name);
    }
  }
  return [text, categories.sort()];
}
export const mergeStrings = (...groups: string[][]) => [
  ...new Set(groups.flat()),
];
export function atomicWriteJson(path: string, value: JsonObject): void {
  ensurePrivateDir(dirname(path));
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}
function atomicWrite(path: string, value: string, mode: number): void {
  const temp = join(dirname(path), `.observer-${randomUUID()}.json`);
  try {
    writeFileSync(temp, value, { encoding: "utf8", mode, flag: "wx" });
    chmodSync(temp, mode);
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}
export function atomicWriteText(path: string, value: string): void {
  atomicWrite(path, value, statSync(path).mode & 0o777);
}
export function fileLock<T>(path: string, operation: () => T, timeout = 2): T {
  ensurePrivateDir(dirname(path));
  const end = performance.now() + timeout * 1000;
  while (true) {
    try {
      mkdirSync(path, { mode: 0o700 });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (performance.now() >= end)
        throw new Error(
          `timed out acquiring ${path}; remove it if no observer process is active`,
        );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return operation();
  } finally {
    try {
      rmdirSync(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
}
export const draftPath = (root: string, session: string, turn: string) =>
  join(
    root,
    ".drafts",
    `${createHash("sha256").update(`${session}\0${turn}`).digest("hex").slice(0, 32)}.json`,
  );
export function loadJson(path: string): JsonObject | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must contain a JSON object`);
  return value as JsonObject;
}
export function toolArguments(payload: JsonObject): JsonObject {
  let value = payload.tool_input || {};
  if (typeof value === "string") value = JSON.parse(value);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("tool_input must be an object");
  return value;
}
export const shortToolName = (name: string) => name.split("__").at(-1)!;
export function applyMarker(
  draft: JsonObject,
  name: string,
  args: JsonObject,
): void {
  if (name === "mark_skill_invocation") {
    const skill = String(args.skill_name ?? "")
      .trim()
      .toLowerCase();
    if (!SKILL_NAME.test(skill))
      throw new Error(
        "skill_name must use 1-64 lowercase letters, digits, underscores, or hyphens",
      );
    const [version, found] = redact(String(args.skill_version ?? "").trim());
    draft.skill = { name: skill };
    if (version) draft.skill.version = version;
    draft.attribution = {
      method: "instrumented",
      confidence: 1,
      evidence: ["Skill invocation marked through the observer MCP tool"],
    };
    draft.redactions = mergeStrings(draft.redactions || [], found);
    return;
  }
  if (name === "attach_skill_evidence") {
    const [kind, r0] = redact(String(args.kind ?? "").trim());
    if (!kind) throw new Error("kind is required");
    const [ref, r1] = redact(args.reference ?? "");
    const [summary, r2] = redact(args.summary ?? "");
    (draft.evidence ??= []).push({
      kind,
      ...(ref ? { ref } : {}),
      ...(summary ? { summary } : {}),
    });
    draft.redactions = mergeStrings(draft.redactions || [], r0, r1, r2);
    return;
  }
  if (name === "record_skill_feedback") {
    const sentiment = String(args.sentiment ?? "");
    if (!SENTIMENTS.has(sentiment))
      throw new Error(
        "sentiment must be positive, negative, mixed, neutral, or empty",
      );
    const [comment, found] = redact(args.comment ?? "");
    draft.feedback = {
      ...(sentiment ? { sentiment } : {}),
      ...(comment ? { comment } : {}),
    };
    draft.redactions = mergeStrings(draft.redactions || [], found);
    return;
  }
  throw new Error(`unsupported observer tool '${name}'`);
}
export function assignObservationId(o: JsonObject): string {
  const material = [
    o.host.name,
    o.skill.name,
    o.skill.version || "",
    o.attribution.method,
    o.input.text,
    o.outcome.status,
    o.outcome.final_message || "",
    o.correlation.session_id,
    o.correlation.turn_id || "",
  ].join("\0");
  return `obs_${createHash("sha256").update(material).digest("hex").slice(0, 24)}`;
}
export function validateObservation(o: JsonObject): void {
  if (o.schema_version !== SCHEMA_VERSION)
    throw new Error("schema_version must be v1alpha1");
  if (!OBSERVATION_ID.test(String(o.id || "")))
    throw new Error("invalid observation id");
  if (!["codex", "dsh"].includes(o.host?.name))
    throw new Error("host.name must be codex or dsh");
  if (!SKILL_NAME.test(String(o.skill?.name || "")))
    throw new Error("invalid skill.name");
  if (!["explicit", "instrumented"].includes(o.attribution?.method))
    throw new Error("attribution.method must be explicit or instrumented");
  if (!String(o.input?.text || ""))
    throw new Error("input.text is required for replayable candidate cases");
  if (!["completed", "interrupted"].includes(o.outcome?.status))
    throw new Error("outcome.status must be completed or interrupted");
  if (!String(o.correlation?.session_id || ""))
    throw new Error("correlation.session_id is required");
  if (o.privacy?.storage !== "local")
    throw new Error("privacy.storage must be local");
  if (!["candidate", "approved", "rejected"].includes(o.review?.status))
    throw new Error("invalid review.status");
  if (o.feedback && !SENTIMENTS.has(o.feedback.sentiment || ""))
    throw new Error("invalid feedback.sentiment");
}
export function saveObservation(root: string, o: JsonObject): boolean {
  validateObservation(o);
  ensurePrivateDir(root);
  const path = join(root, `${o.id}.json`);
  return fileLock(`${path}.lock`, () => {
    if (existsSync(path)) return false;
    atomicWriteJson(path, o);
    return true;
  });
}
export function handleHook(
  payload: JsonObject,
  root = dataDir(),
): JsonObject | null {
  const session = String(payload.session_id ?? ""),
    turn = String(payload.turn_id ?? ""),
    event = String(payload.hook_event_name ?? "");
  if (!session) throw new Error("hook payload session_id is required");
  const path = draftPath(root, session, turn);
  return fileLock(`${path}.lock`, () => {
    if (event === "UserPromptSubmit") {
      const [prompt, redactions] = redact(payload.prompt ?? "");
      const draft: JsonObject = {
        session_id: session,
        turn_id: turn,
        model: String(payload.model ?? ""),
        prompt,
        skill: {},
        attribution: {},
        redactions,
        observed_at: utcNow(),
      };
      for (const match of prompt.matchAll(
        /(?:^|\s)\$([A-Za-z0-9][A-Za-z0-9_-]*)/g,
      )) {
        const name = match[1].toLowerCase();
        if (!CONTROL.has(name) && SKILL_NAME.test(name)) {
          draft.skill = { name };
          draft.attribution = {
            method: "explicit",
            confidence: 1,
            evidence: [`user prompt explicitly referenced $${name}`],
          };
          break;
        }
      }
      atomicWriteJson(path, draft);
      return null;
    }
    if (event === "PostToolUse") {
      const draft = loadJson(path) || {
        session_id: session,
        turn_id: turn,
        model: String(payload.model ?? ""),
        prompt: "",
        skill: {},
        attribution: {},
        redactions: [],
        observed_at: utcNow(),
      };
      applyMarker(
        draft,
        shortToolName(String(payload.tool_name ?? "")),
        toolArguments(payload),
      );
      atomicWriteJson(path, draft);
      return null;
    }
    if (!["Stop", "Interrupt"].includes(event))
      throw new Error(`unsupported hook event '${event}'`);
    const draft = loadJson(path);
    rmSync(path, { force: true });
    if (
      !draft?.skill?.name ||
      !["explicit", "instrumented"].includes(draft.attribution?.method) ||
      !draft.prompt
    )
      return null;
    const [message, redactions] = redact(payload.last_assistant_message ?? "");
    const o: JsonObject = {
      schema_version: SCHEMA_VERSION,
      id: "",
      host: { name: "codex", adapter_version: "v1alpha1" },
      skill: draft.skill,
      attribution: draft.attribution,
      input: { text: draft.prompt },
      outcome: { status: event === "Stop" ? "completed" : "interrupted" },
      correlation: { session_id: session },
      timing: { observed_at: draft.observed_at, completed_at: utcNow() },
      privacy: {
        storage: "local",
        consent: "codex_plugin_enabled_and_hooks_trusted",
        redactions: mergeStrings(draft.redactions || [], redactions),
      },
      review: { status: "candidate" },
    };
    if (draft.model) o.host.version = draft.model;
    if (message) o.outcome.final_message = message;
    if (turn) o.correlation.turn_id = turn;
    if (draft.evidence?.length) o.evidence = draft.evidence;
    if (draft.feedback && Object.keys(draft.feedback).length)
      o.feedback = draft.feedback;
    o.id = assignObservationId(o);
    saveObservation(root, o);
    return o;
  });
}
export function safeObservationPath(root: string, id: string): string {
  if (!OBSERVATION_ID.test(id)) throw new Error("invalid observation id");
  return join(root, `${id}.json`);
}
export function getObservation(root: string, id: string): JsonObject {
  const o = loadJson(safeObservationPath(root, id));
  if (!o) throw new Error(`observation ${id} does not exist`);
  validateObservation(o);
  return o;
}
export function listObservations(root: string): JsonObject[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((p) => /^obs_.*\.json$/.test(p))
    .map((p) => loadJson(join(root, p)))
    .filter((o): o is JsonObject => o !== null)
    .map((o) => {
      validateObservation(o);
      return o;
    })
    .sort((a, b) =>
      String(b.timing.observed_at).localeCompare(a.timing.observed_at),
    );
}
export function setReview(
  root: string,
  id: string,
  status: string,
): JsonObject {
  if (!["approved", "rejected"].includes(status))
    throw new Error("status must be approved or rejected");
  const path = safeObservationPath(root, id);
  return fileLock(`${path}.lock`, () => {
    const o = getObservation(root, id);
    o.review = { status, reviewed_at: utcNow() };
    atomicWriteJson(path, o);
    return o;
  });
}
export function candidateCase(o: JsonObject): [string, string] {
  validateObservation(o);
  const name = o.skill.name;
  const base =
    name
      .toLowerCase()
      .replaceAll("_", "-")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "skill";
  const id = `observed-${base}-${o.id.slice(4, 12)}`;
  let description = `Candidate regression case from local observation ${o.id}. Review the prompt and add concrete expectations before relying on it as a release gate.`;
  if (o.feedback?.comment)
    description += ` User feedback: ${o.feedback.comment}`;
  return [
    [
      `id: ${JSON.stringify(id)}`,
      `title: ${JSON.stringify(`Observed ${name} interaction`)}`,
      `description: ${JSON.stringify(description)}`,
      'tag: "functional_test"',
      "input:",
      `  prompt: ${JSON.stringify(o.input.text)}`,
      "",
    ].join("\n"),
    id,
  ];
}
export function appendCaseReference(text: string, path: string): string {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const start = lines.findIndex((line) =>
    /^cases:\s*(?:#.*)?(?:\r?\n)?$/.test(line),
  );
  if (start < 0)
    throw new Error("eval.yaml must contain a top-level cases mapping");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const s = lines[i].trim();
    if (
      s &&
      !s.startsWith("#") &&
      lines[i].length === lines[i].trimStart().length
    ) {
      end = i;
      break;
    }
  }
  let idx = -1,
    indent = 0,
    inline = "";
  for (let i = start + 1; i < end; i++) {
    const m = /^(\s+)files:\s*(.*?)\s*(?:#.*)?(?:\r?\n)?$/.exec(lines[i]);
    if (m) {
      idx = i;
      indent = m[1].length;
      inline = m[2];
      break;
    }
  }
  if (idx < 0) throw new Error("eval.yaml cases must contain files");
  const line = `${" ".repeat(indent + 2)}- ${path}\n`;
  if (inline === "[]") {
    const nl = lines[idx].endsWith("\r\n") ? "\r\n" : "\n";
    lines[idx] = `${" ".repeat(indent)}files:${nl}`;
    lines.splice(idx + 1, 0, line.replace("\n", nl));
    return lines.join("");
  }
  if (inline)
    throw new Error(
      "flow-style non-empty cases.files is not supported; use a block sequence",
    );
  let insert = end;
  for (let i = idx + 1; i < end; i++) {
    const s = lines[i].trim(),
      n = lines[i].length - lines[i].trimStart().length;
    if (s && !s.startsWith("#") && n <= indent) {
      insert = i;
      break;
    }
    if (
      s.startsWith("-") &&
      s
        .slice(1)
        .trim()
        .replace(/^['"]+|['"]+$/g, "") === path
    )
      throw new Error(`eval.yaml already references ${path}`);
  }
  lines.splice(insert, 0, line);
  return lines.join("");
}
export function requireWithin(
  root: string,
  path: string,
  label: string,
): string {
  const p = realpathSync(path),
    rel = relative(root, p);
  if (
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  )
    throw new Error(`${label} must resolve inside the Skill root`);
  return p;
}
export function writeCandidateCase(
  _root: string,
  o: JsonObject,
  input: string,
): JsonObject {
  if (o.review.status !== "approved")
    throw new Error("observation must be approved before writing a case");
  const requested = resolve(expand(input));
  const skill = existsSync(requested) ? realpathSync(requested) : requested;
  if (!existsSync(skill) || !statSync(skill).isDirectory())
    throw new Error("skill root must be a directory");
  if (
    !existsSync(join(skill, "SKILL.md")) ||
    !statSync(join(skill, "SKILL.md")).isFile()
  )
    throw new Error("skill root must contain SKILL.md");
  requireWithin(skill, join(skill, "SKILL.md"), "SKILL.md");
  const evals = requireWithin(skill, join(skill, "evals"), "evals directory");
  if (
    !existsSync(join(evals, "eval.yaml")) ||
    !statSync(join(evals, "eval.yaml")).isFile()
  )
    throw new Error("skill root must contain evals/eval.yaml");
  const evalPath = requireWithin(skill, join(evals, "eval.yaml"), "eval.yaml");
  return fileLock(
    join(evals, ".skilled-observer.lock"),
    () => {
      const [text, id] = candidateCase(o);
      const ref = `evals/cases/${id}.yaml`;
      mkdirSync(join(evals, "cases"), { recursive: true, mode: 0o755 });
      const cases = requireWithin(
          skill,
          join(evals, "cases"),
          "cases directory",
        ),
        path = join(cases, `${id}.yaml`),
        original = readFileSync(evalPath, "utf8"),
        updated = appendCaseReference(original, ref);
      try {
        writeFileSync(path, text, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST")
          throw new Error(`candidate case already exists: ${path}`);
        throw e;
      }
      let validation = "skipped (skilled is not installed)";
      try {
        atomicWriteText(evalPath, updated);
        const result = spawnSync("skilled", ["validate", evalPath], {
          cwd: skill,
          encoding: "utf8",
          timeout: 60_000,
        });
        if (result.error) {
          if ((result.error as NodeJS.ErrnoException).code !== "ENOENT")
            throw result.error;
        } else {
          if (result.status !== 0)
            throw new Error(
              `skilled validate failed: ${(result.stderr || result.stdout).trim()}`,
            );
          validation = "passed";
        }
      } catch (e) {
        atomicWriteText(evalPath, original);
        rmSync(path, { force: true });
        throw e;
      }
      return { case_path: path, eval_path: evalPath, validation };
    },
    30,
  );
}

export const TOOLS = [
  {
    name: "mark_skill_invocation",
    description: "Declare the Skill responsible for the current interaction.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        skill_name: {
          type: "string",
        },
        skill_version: {
          type: "string",
        },
      },
      required: ["skill_name"],
    },
  },
  {
    name: "attach_skill_evidence",
    description:
      "Attach a local reference or summary to the current Skill interaction.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
        },
        reference: {
          type: "string",
        },
        summary: {
          type: "string",
        },
      },
      required: ["kind"],
    },
  },
  {
    name: "record_skill_feedback",
    description:
      "Record explicit user feedback for the current Skill interaction.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sentiment: {
          type: "string",
          enum: ["positive", "negative", "mixed", "neutral"],
        },
        comment: {
          type: "string",
        },
      },
    },
  },
  {
    name: "list_skill_observations",
    description: "List locally stored Skill observations.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
  },
  {
    name: "get_skill_observation",
    description: "Read one local Skill observation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        observation_id: {
          type: "string",
        },
      },
      required: ["observation_id"],
    },
  },
  {
    name: "review_skill_observation",
    description:
      "Approve or reject one observation after explicit user review.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        observation_id: {
          type: "string",
        },
        status: {
          type: "string",
          enum: ["approved", "rejected"],
        },
      },
      required: ["observation_id", "status"],
    },
  },
  {
    name: "preview_observation_case",
    description: "Preview a candidate regression case without writing files.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        observation_id: {
          type: "string",
        },
      },
      required: ["observation_id"],
    },
  },
  {
    name: "write_observation_case",
    description:
      "Write an approved observation as a candidate case and update eval.yaml.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        observation_id: {
          type: "string",
        },
        skill_root: {
          type: "string",
        },
      },
      required: ["observation_id", "skill_root"],
    },
  },
];
export function callTool(
  name: string,
  args: JsonObject,
  root: string,
): unknown {
  if (
    [
      "mark_skill_invocation",
      "attach_skill_evidence",
      "record_skill_feedback",
    ].includes(name)
  ) {
    applyMarker({ redactions: [] }, name, args);
    return {
      accepted: true,
      tool: name,
      note: "The matching PostToolUse hook persists this marker.",
    };
  }
  if (name === "list_skill_observations")
    return {
      observations: listObservations(root).map((o) => ({
        id: o.id,
        skill: o.skill.name,
        review: o.review.status,
        outcome: o.outcome.status,
        observed_at: o.timing.observed_at,
      })),
    };
  const id = String(args.observation_id ?? "");
  if (name === "get_skill_observation") return getObservation(root, id);
  if (name === "review_skill_observation")
    return setReview(root, id, String(args.status ?? ""));
  if (name === "preview_observation_case") {
    const [yaml, case_id] = candidateCase(getObservation(root, id));
    return { case_id, yaml };
  }
  if (name === "write_observation_case")
    return writeCandidateCase(
      root,
      getObservation(root, id),
      String(args.skill_root ?? ""),
    );
  throw new Error(`unknown observer tool '${name}'`);
}
export const rpcResult = (id: unknown, result: unknown) => ({
  jsonrpc: "2.0",
  id,
  result,
});
export function handleRpc(
  request: JsonObject,
  root: string,
): JsonObject | null {
  if (!Object.hasOwn(request, "id")) return null;
  const id = request.id,
    method = request.method;
  if (method === "initialize")
    return rpcResult(id, {
      protocolVersion: request.params?.protocolVersion || "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: PLUGIN_NAME, version: "0.1.0" },
    });
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });
  if (method === "tools/call") {
    const params = request.params || {};
    try {
      const value = callTool(
        String(params.name ?? ""),
        params.arguments || {},
        root,
      );
      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
        structuredContent: value,
      });
    } catch (e) {
      return rpcResult(id, {
        content: [
          { type: "text", text: e instanceof Error ? e.message : String(e) },
        ],
        isError: true,
      });
    }
  }
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: "method not found" },
  };
}
export async function serveMcp(root = dataDir()): Promise<void> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    let request: JsonObject;
    try {
      request = JSON.parse(line);
    } catch {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "parse error" },
        }) + "\n",
      );
      continue;
    }
    const response = handleRpc(request, root);
    if (response !== null)
      process.stdout.write(JSON.stringify(response) + "\n");
  }
}
export async function main(): Promise<number> {
  const command = process.argv[2];
  if (!["mcp", "ingest-hook"].includes(command)) {
    console.error("usage: observer.js {ingest-hook,mcp}");
    return 2;
  }
  try {
    if (command === "mcp") await serveMcp();
    else {
      handleHook(JSON.parse(readFileSync(0, "utf8")));
      console.log("{}");
    }
    return 0;
  } catch (e) {
    console.error(
      `codex-skilled: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }
}
if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  process.exitCode = await main();
