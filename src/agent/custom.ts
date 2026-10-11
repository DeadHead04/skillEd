// Modified for the skilled TypeScript distribution.
import { normalizeSessionResult } from "./types.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BaseAgent,
  formatAgentModel,
  shellQuote,
  writeLocalArtifact,
} from "./base.js";
import { AgentExecutionError } from "./errors.js";
import type {
  AgentConfig,
  Agent,
  Runtime,
  ExecOptions,
  MCPConfig,
  SkillConfig,
  SessionResult,
  SessionArtifacts,
  ArtifactFile,
} from "./types.js";
import type { CustomEngineConfig } from "../contracts/schema.js";
import type { Message, Transcript } from "../contracts/transcript.js";
import { finalAssistantMessage } from "../contracts/transcript.js";
import { infof, warnf, debugf } from "../logging/index.js";
import { runLocalTransport } from "./custom-local.js";
import { runHTTPTransport } from "./custom-http.js";
import {
  renderTemplate,
  renderTemplateMap,
  singleTurnPrompt,
  workspacePath,
  deriveTurns,
  minimalCustomTranscript,
  validateArtifactFiles,
  decodeBase64,
  readLimitedResponse,
  combinedSignal,
  customDefaultInputFile,
  customDefaultOutputFile,
  customStaleClearedMarker,
  maxInlineArtifactBytes,
  maxArtifactDownloadBytes,
} from "./custom-support.js";
export * from "./custom-support.js";
export interface SessionMessage {
  role: string;
  content: string;
}
export interface SessionInput {
  case_id?: string;
  variant?: string;
  workspace?: string;
  model?: string;
  session_id?: string;
  messages: SessionMessage[];
  max_turns?: number;
  timeout_seconds?: number;
}
export interface CustomRunPrep {
  custom: CustomEngineConfig;
  vars: Record<string, string>;
  sessJSON: string;
  sessionID: string;
  timeoutSec: number;
  messages: Message[];
  start: number;
}
export interface TransportOutcome {
  raw: string;
  stdout: string;
  exitCode: number;
  stderr: string;
  execErr?: Error;
  frameworkFiles: string[];
}
export class CustomAgent extends BaseAgent implements Agent {
  constructor(cfg: AgentConfig) {
    super(cfg);
  }
  async install(_rt: Runtime, _signal?: AbortSignal): Promise<void> {}
  async check(_rt: Runtime, _signal?: AbortSignal): Promise<void> {}
  override async checkCredentials(_signal?: AbortSignal): Promise<void> {}
  async installMCP(
    _rt: Runtime,
    cfg: MCPConfig,
    _signal?: AbortSignal,
  ): Promise<void> {
    if (cfg.servers.length)
      infof(
        "CustomAgent %s: %d MCP server(s) declared; a custom engine manages MCP itself, skipping installation",
        JSON.stringify(this.name()),
        cfg.servers.length,
      );
  }
  async installSkill(
    rt: Runtime,
    cfg: SkillConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.installSkillDefault(rt, cfg, signal);
  }
  async run(
    rt: Runtime,
    opts: ExecOptions,
    messages: Message[],
  ): Promise<SessionResult> {
    return this.executeCustom(rt, opts, messages, "");
  }
  async executeCustom(
    rt: Runtime,
    opts: ExecOptions,
    messages: Message[],
    sessionID: string,
  ): Promise<SessionResult> {
    try {
      const custom = this.cfg.custom;
      if (!custom) throw new Error("custom engine config is missing");
      if (!["local", "http"].includes(custom.transport))
        throw new Error(
          `custom engine transport ${JSON.stringify(custom.transport)} is not supported`,
        );
      const prep = this.prepareRun(rt, opts, messages, sessionID, custom);
      const outcome =
        custom.transport === "local"
          ? await runLocalTransport(this, rt, opts, prep)
          : await runHTTPTransport(this, rt, opts, prep);
      const result = await this.assembleResult(rt, opts, prep, outcome);
      this.annotateSessionResult(result);
      return normalizeSessionResult(result);
    } catch (error) {
      const failure =
        error instanceof AgentExecutionError
          ? error
          : new AgentExecutionError(
              (error as Error).message,
              this.errorResult(0),
              { cause: error },
            );
      this.annotateSessionResult(failure.result);
      normalizeSessionResult(failure.result);
      throw failure;
    }
  }
  prepareRun(
    rt: Runtime,
    opts: ExecOptions,
    messages: Message[],
    sessionID: string,
    custom: CustomEngineConfig,
  ): CustomRunPrep {
    const start = performance.now();
    let timeoutSec = custom.timeout_seconds;
    const outer = (opts.timeoutMs ?? 0) / 1000;
    if (timeoutSec <= 0) timeoutSec = outer;
    else if (outer > 0 && outer < timeoutSec) timeoutSec = outer;
    const base = this.buildBaseVars(rt, opts, messages, timeoutSec);
    let rendered: Record<string, string>;
    try {
      rendered = renderTemplateMap(custom.kwargs, base);
    } catch (e) {
      throw new Error(`render custom.kwargs: ${(e as Error).message}`, {
        cause: e,
      });
    }
    const sess = this.buildSessionInput(
      rt,
      opts,
      messages,
      sessionID,
      timeoutSec,
    );
    const sessJSON = JSON.stringify(sess);
    return {
      custom,
      vars: this.completeTemplateVars(base, rendered, sess, sessJSON),
      sessJSON,
      sessionID,
      timeoutSec,
      messages,
      start,
    };
  }
  buildSessionInput(
    rt: Runtime,
    opts: ExecOptions,
    messages: Message[],
    sessionID: string,
    timeoutSec: number,
  ): SessionInput {
    const meta = opts.agentMetadata;
    const model = formatAgentModel(this.cfg.modelProvider, this.cfg.modelName);
    return {
      ...(meta?.caseID ? { case_id: meta.caseID } : {}),
      ...(meta?.variant ? { variant: meta.variant } : {}),
      ...(rt.workspace() ? { workspace: rt.workspace() } : {}),
      ...(model ? { model } : {}),
      ...(sessionID ? { session_id: sessionID } : {}),
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content ?? "",
      })),
      ...(meta?.maxTurns ? { max_turns: meta.maxTurns } : {}),
      ...(timeoutSec ? { timeout_seconds: timeoutSec } : {}),
    };
  }
  buildBaseVars(
    rt: Runtime,
    opts: ExecOptions,
    messages: Message[],
    timeoutSec: number,
  ): Record<string, string> {
    return {
      workspace: rt.workspace(),
      prompt: singleTurnPrompt(messages),
      input_file: path.join(rt.workspace(), customDefaultInputFile),
      output_file: path.join(rt.workspace(), customDefaultOutputFile),
      model: formatAgentModel(this.cfg.modelProvider, this.cfg.modelName),
      model_provider: this.cfg.modelProvider,
      model_name: this.cfg.modelName,
      api_key: this.cfg.apiKey,
      case_id: opts.agentMetadata?.caseID ?? "",
      variant: opts.agentMetadata?.variant ?? "",
      max_turns: String(opts.agentMetadata?.maxTurns ?? 0),
      timeout_seconds: String(timeoutSec),
    };
  }
  completeTemplateVars(
    base: Record<string, string>,
    kwargs: Record<string, string>,
    session: SessionInput,
    sessJSON: string,
  ): Record<string, string> {
    const msgs = JSON.stringify(session.messages),
      kw = JSON.stringify(kwargs);
    return {
      ...base,
      messages: msgs,
      messages_json: msgs,
      session_input: sessJSON,
      session_input_json: sessJSON,
      kwargs: kw,
      kwargs_json: kw,
      ...Object.fromEntries(
        Object.entries(kwargs).map(([k, v]) => ["kwargs." + k, v]),
      ),
    };
  }
  async clearStaleOutputFile(
    rt: Runtime,
    outputFile: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      const safe = await workspacePath(rt, outputFile);
      const q = shellQuote(safe);
      const result = await rt.exec(
        `if [ -e ${q} ]; then rm -f -- ${q} && printf %s ${shellQuote(customStaleClearedMarker)}; fi`,
        { signal },
      );
      return result.stdout.includes(customStaleClearedMarker);
    } catch (e) {
      debugf(
        "CustomAgent: could not clear stale output file %s: %s",
        outputFile,
        String(e),
      );
      return false;
    }
  }
  async buildLocalExec(
    rt: Runtime,
    opts: ExecOptions,
    custom: CustomEngineConfig,
    vars: Record<string, string>,
    timeoutSec: number,
  ): Promise<{ command: string; options: ExecOptions }> {
    const local = custom.local!;
    const render = (raw: string, field: string) => {
      try {
        return renderTemplate(raw, vars);
      } catch (e) {
        throw new Error(`render ${field}: ${(e as Error).message}`, {
          cause: e,
        });
      }
    };
    const command = render(local.command, "local.command");
    if (this.containsAPIKey(command)) throw errSecretInCommand("local.command");
    const parts = [shellQuote(command)];
    for (const [i, raw] of local.args.entries()) {
      const arg = render(raw, `local.args[${i}]`);
      if (this.containsAPIKey(arg))
        throw errSecretInCommand(`local.args[${i}]`);
      parts.push(shellQuote(arg));
    }
    let cwd = rt.workspace();
    if (local.cwd)
      try {
        cwd = await workspacePath(rt, render(local.cwd, "local.cwd"));
      } catch (e) {
        throw new Error(`local.cwd: ${(e as Error).message}`, { cause: e });
      }
    let env: Record<string, string>;
    try {
      env = renderTemplateMap(custom.env, vars);
    } catch (e) {
      throw new Error(`render custom.env: ${(e as Error).message}`, {
        cause: e,
      });
    }
    const options = this.mergeExecOptionsEnv(
      {
        cwd,
        timeoutMs: timeoutSec * 1000,
        artifactDir: opts.artifactDir,
        signal: opts.signal,
        context: opts.context,
      },
      env,
      this.buildAgentObservabilityAttrs(),
    );
    return { command: parts.join(" "), options };
  }
  async assembleResult(
    rt: Runtime,
    opts: ExecOptions,
    prep: CustomRunPrep,
    o: TransportOutcome,
  ): Promise<SessionResult> {
    const duration = Math.floor(performance.now() - prep.start);
    let result: SessionResult, parseErr: Error | undefined;
    try {
      result = await this.buildResult(
        rt,
        opts,
        prep.custom,
        o.raw,
        o.stdout,
        o.exitCode,
        o.stderr,
        duration,
        prep.messages,
      );
    } catch (e) {
      parseErr = e as Error;
      result = this.errorResult(0);
    }
    if (o.execErr) {
      if (parseErr) {
        result = this.errorResult(o.exitCode);
        result.duration_ms = duration;
        result.transcript = minimalCustomTranscript(prep.messages, "");
      } else if (result.exit_code === 0) result.exit_code = o.exitCode || 1;
      result.stderr = this.maskAPIKey(result.stderr || o.stderr);
      this.appendFrameworkFiles(result, o.frameworkFiles);
      throw new AgentExecutionError(
        `custom engine run failed: ${o.execErr.message}`,
        result,
        { cause: o.execErr },
      );
    }
    this.appendFrameworkFiles(result, o.frameworkFiles);
    if (o.exitCode !== 0) {
      result.exit_code = o.exitCode;
      result.stderr = this.maskAPIKey(result.stderr || o.stderr);
      throw new AgentExecutionError(
        `custom engine command exited ${o.exitCode}: ${this.maskAPIKey(o.stderr)}`,
        result,
      );
    }
    if (parseErr) {
      result.stderr = this.maskAPIKey(result.stderr ?? "");
      throw new AgentExecutionError(parseErr.message, result, {
        cause: parseErr,
      });
    }
    if (result.exit_code !== 0) {
      result.stderr = this.maskAPIKey(result.stderr ?? "");
      throw new AgentExecutionError(
        `custom engine run failed (exit ${result.exit_code}): ${result.stderr}`,
        result,
      );
    }
    result.stderr = this.maskAPIKey(result.stderr ?? "");
    return result;
  }
  async buildResult(
    rt: Runtime,
    opts: ExecOptions,
    custom: CustomEngineConfig,
    raw: string,
    stdout: string,
    exitCode: number,
    stderr: string,
    durationMs: number,
    messages: Message[],
  ): Promise<SessionResult> {
    if (custom.response_format === "text") {
      const finalMessage = this.maskAPIKey(stdout.trim());
      return {
        engine: this.name(),
        exit_code: exitCode,
        duration_ms: durationMs,
        turns: 0,
        final_message: finalMessage,
        stderr: this.maskAPIKey(stderr),
        transcript: minimalCustomTranscript(messages, finalMessage),
        artifacts: {},
      };
    }
    return this.parseSessionResult(rt, opts, raw, durationMs, messages);
  }
  appendFrameworkFiles(result: SessionResult, files: string[]): void {
    const artifacts = (result.artifacts ??= {});
    Object.defineProperty(artifacts, "generated_file_sources", {
      value: [...(artifacts.generated_file_sources ?? []), ...files],
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  async readRawResult(
    rt: Runtime,
    custom: CustomEngineConfig,
    stdout: string,
    outputFile: string,
    signal?: AbortSignal,
  ): Promise<{ raw: string; produced: boolean }> {
    if (outputFile)
      try {
        outputFile = await workspacePath(rt, outputFile);
      } catch (e) {
        warnf(
          "CustomAgent: refusing to read output file %s after run: %s",
          outputFile,
          String(e),
        );
        return { raw: stdout.trim(), produced: false };
      }
    if (!custom.local!.output_file || !outputFile)
      return { raw: stdout, produced: false };
    let dir: string;
    try {
      dir = await mkdtemp(path.join(os.tmpdir(), "skilled-custom-result-"));
    } catch {
      return { raw: stdout, produced: false };
    }
    try {
      const temp = path.join(dir, "result");
      try {
        await rt.downloadFile(outputFile, temp, signal);
      } catch (e) {
        warnf(
          "CustomAgent: cannot read output_file %s, falling back to stdout: %s",
          outputFile,
          String(e),
        );
        return { raw: stdout, produced: false };
      }
      try {
        const data = await readFile(temp, "utf8");
        return { raw: data.trim() ? data : stdout, produced: true };
      } catch {
        return { raw: stdout, produced: true };
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  async synthesizeTimeoutOutput(
    artifactDir: string | undefined,
    prep: CustomRunPrep,
  ): Promise<string> {
    const raw = JSON.stringify({
      engine: this.name(),
      exit_code: 124,
      duration_ms: Math.floor(performance.now() - prep.start),
      final_message: "",
      stderr:
        "skilled: case deadline exceeded before the engine wrote its session result (synthesized artifact; the engine's transcript was lost with the killed process)",
    });
    if (artifactDir)
      try {
        await writeLocalArtifact(artifactDir, "session-result.json", raw);
      } catch (e) {
        warnf(
          "CustomAgent: cannot archive synthesized timeout result into %s: %s",
          artifactDir,
          String(e),
        );
      }
    return raw;
  }
  async parseSessionResult(
    rt: Runtime,
    opts: ExecOptions,
    raw: string,
    durationMs: number,
    messages: Message[],
  ): Promise<SessionResult> {
    if (!raw.trim()) throw new Error("custom engine returned an empty result");
    let parsed: SessionResult;
    try {
      parsed = decodeSessionResult(raw);
    } catch (e) {
      throw new Error(
        `custom engine result is not valid JSON: ${(e as Error).message}`,
        { cause: e },
      );
    }
    if (parsed.exit_code === undefined)
      throw new Error("custom engine returned a result without exit_code");
    const artifacts = parsed.artifacts ?? {};
    validateArtifactFiles(artifacts.files ?? []);
    await this.collectArtifacts(rt, opts, artifacts);
    let finalMessage = this.maskAPIKey(parsed.final_message ?? "");
    let transcript = this.maskTranscript(parsed.transcript ?? []);
    if (!finalMessage && transcript.length)
      finalMessage = finalAssistantMessage(transcript);
    if (!transcript.length)
      transcript = minimalCustomTranscript(messages, finalMessage);
    return {
      engine: this.maskAPIKey(parsed.engine ?? "") || this.name(),
      model: this.maskAPIKey(parsed.model ?? ""),
      session_id: parsed.session_id ?? "",
      exit_code: parsed.exit_code,
      duration_ms: parsed.duration_ms || durationMs,
      turns: parsed.turns || deriveTurns(transcript),
      input_tokens: parsed.input_tokens ?? 0,
      output_tokens: parsed.output_tokens ?? 0,
      final_message: finalMessage,
      stderr: this.maskAPIKey(parsed.stderr ?? ""),
      transcript,
      artifacts,
    };
  }
  async collectArtifacts(
    rt: Runtime,
    opts: ExecOptions,
    artifacts: SessionArtifacts,
  ): Promise<void> {
    const paths: string[] = [];
    for (const p of artifacts.generated_files ?? [])
      try {
        paths.push(await workspacePath(rt, p));
      } catch (e) {
        warnf(
          "CustomAgent: dropping generated_files entry %s: %s",
          JSON.stringify(p),
          String(e),
        );
      }
    artifacts.generated_files = paths;
    for (const f of artifacts.files ?? []) {
      if (f.path) {
        let safe: string;
        try {
          safe = await workspacePath(rt, f.path);
        } catch (e) {
          warnf(
            "CustomAgent: dropping artifact %s with path %s: %s",
            JSON.stringify(f.name),
            JSON.stringify(f.path),
            String(e),
          );
          continue;
        }
        paths.push(safe);
        const renamed = await this.archiveRenamedPathArtifact(rt, opts, {
          name: f.name,
          path: safe,
        });
        if (renamed) paths.push(renamed);
      } else if (f.content || f.content_base64) {
        const saved = await this.writeInlineArtifact(opts, f);
        if (saved) paths.push(saved);
      } else if (f.url) {
        const saved = await this.downloadURLArtifact(opts, f);
        if (saved) paths.push(saved);
      }
    }
  }
  async archiveRenamedPathArtifact(
    rt: Runtime,
    opts: ExecOptions,
    f: ArtifactFile,
  ): Promise<string> {
    const name = path.basename(f.name);
    if (!f.name || !opts.artifactDir || name === path.basename(f.path!))
      return "";
    try {
      const safe = await workspacePath(rt, f.path!);
      const dest = path.join(opts.artifactDir, name);
      await rt.downloadFile(safe, dest, opts.signal);
      return dest;
    } catch (e) {
      warnf(
        "CustomAgent: cannot archive artifact %s from %s: %s",
        name,
        f.path,
        String(e),
      );
      return "";
    }
  }
  async writeInlineArtifact(
    opts: ExecOptions,
    f: ArtifactFile,
  ): Promise<string> {
    if (!opts.artifactDir || !f.name) return "";
    try {
      const content = f.content_base64
        ? decodeBase64(f.content_base64)
        : Buffer.from(f.content ?? "");
      if (content.length > maxInlineArtifactBytes)
        throw new Error("inline size limit exceeded after decode");
      return await writeLocalArtifact(opts.artifactDir, f.name, content);
    } catch (e) {
      warnf(
        "CustomAgent: cannot write inline artifact %s: %s",
        JSON.stringify(f.name),
        String(e),
      );
      return "";
    }
  }
  async downloadURLArtifact(
    opts: ExecOptions,
    f: ArtifactFile,
  ): Promise<string> {
    if (!opts.artifactDir || !f.name) return "";
    try {
      const url = new URL(f.url!);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error(`url scheme ${url.protocol} is not http(s)`);
      if (this.containsAPIKey(f.url!))
        throw new Error("url embeds the API key; skipping download");
      const response = await fetch(f.url!, {
        signal: combinedSignal(opts.signal, 60_000),
        redirect: "manual",
      });
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel();
        throw new Error(`url returned status ${response.status}`);
      }
      const body = await readLimitedResponse(
        response,
        maxArtifactDownloadBytes,
      );
      return await writeLocalArtifact(opts.artifactDir, f.name, body);
    } catch (e) {
      warnf(
        "CustomAgent: cannot download artifact %s: %s",
        JSON.stringify(f.name),
        this.maskAPIKey((e as Error).message),
      );
      return "";
    }
  }
  containsAPIKey(value: string): boolean {
    return !!this.cfg.apiKey && value.includes(this.cfg.apiKey);
  }
  maskAPIKey(value: string): string {
    if (this.cfg.apiKey)
      value = value.replaceAll(this.cfg.apiKey, "***REDACTED***");
    for (const secret of Object.values(this.cfg.custom?.env ?? {}))
      if (Buffer.byteLength(secret) >= 8)
        value = value.replaceAll(secret, "***REDACTED***");
    return value;
  }
  maskTranscript(transcript: Transcript): Transcript {
    return transcript.map((m) => ({
      ...m,
      content: this.maskAPIKey(m.content ?? ""),
    }));
  }
  errorResult(exitCode: number): SessionResult {
    return {
      engine: this.name(),
      exit_code: exitCode || 1,
      duration_ms: 0,
      turns: 0,
      artifacts: {},
    };
  }
}
export class StatefulCustomAgent extends CustomAgent {
  constructor(cfg: AgentConfig | CustomAgent) {
    super(cfg instanceof CustomAgent ? cfg.cfg : cfg);
  }
  async runTurn(
    rt: Runtime,
    opts: ExecOptions,
    message: Message,
    sessionID: string,
  ): Promise<SessionResult> {
    return this.executeCustom(rt, opts, [message], sessionID);
  }
  requiresSessionIDForNextTurn(): boolean {
    return true;
  }
  returnsIncrementalSessionResults(): boolean {
    return true;
  }
}
export function errSecretInCommand(field: string): Error {
  return new Error(
    `engine.custom.${field} renders the API key into the command line, which would expose it in process listings and traces; reference \${api_key} from engine.custom.env instead`,
  );
}
export function usableSessionResult(raw: string): boolean {
  try {
    return decodeSessionResult(raw).exit_code !== undefined;
  } catch {
    return false;
  }
}
const numericLexemes = new WeakMap<object, Map<string, string>>();
function object(value: unknown, label: string): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function typedFields(
  value: unknown,
  strings: string[],
  integers: string[],
  label: string,
): Record<string, unknown> {
  const raw = object(value, label),
    out: Record<string, unknown> = {};
  for (const key of strings) {
    const v = raw[key];
    if (v == null) continue;
    if (typeof v !== "string")
      throw new Error(`${label}.${key} must be a string`);
    out[key] = v;
  }
  for (const key of integers) {
    const v = raw[key];
    if (v == null) continue;
    if (
      typeof v !== "number" ||
      !Number.isInteger(v) ||
      v < -(2 ** 63) ||
      v >= 2 ** 63 ||
      !/^-?[0-9]+$/.test(numericLexemes.get(raw)?.get(key) ?? String(v))
    )
      throw new Error(`${label}.${key} must be an integer`);
    out[key] = v;
  }
  return out;
}
export function decodeSessionResult(raw: string): SessionResult {
  const value = JSON.parse(raw, function (key, value) {
    const lexical = arguments[2]?.source;
    if (typeof value === "number" && typeof lexical === "string") {
      let fields = numericLexemes.get(this);
      if (!fields) {
        fields = new Map();
        numericLexemes.set(this, fields);
      }
      fields.set(key, lexical);
    }
    return value;
  });
  const data = object(value, "result");
  const result = typedFields(
    data,
    ["engine", "model", "session_id", "final_message", "stderr"],
    ["exit_code", "duration_ms", "turns", "input_tokens", "output_tokens"],
    "result",
  );
  if (data.transcript != null) {
    if (!Array.isArray(data.transcript))
      throw new Error("transcript must be an array");
    result.transcript = data.transcript.map((m0, i) => {
      const m = object(m0, "message");
      const msg = typedFields(
        m,
        ["role", "content"],
        ["turn"],
        `transcript[${i}]`,
      );
      if (m.timestamp != null) {
        if (
          typeof m.timestamp !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
            m.timestamp,
          ) ||
          Number.isNaN(Date.parse(m.timestamp))
        )
          throw new Error("invalid transcript timestamp");
        msg.timestamp = m.timestamp;
      }
      if (m.tool_call != null) {
        const tc = object(m.tool_call, "tool_call");
        const call = typedFields(tc, ["id", "name"], [], "tool_call");
        if (tc.arguments != null)
          call.arguments = object(tc.arguments, "tool_call.arguments");
        msg.tool_call = call;
      }
      if (m.tool_result != null) {
        const tr = object(m.tool_result, "tool_result");
        msg.tool_result = {
          ...typedFields(
            tr,
            ["call_id", "status"],
            ["duration_ms"],
            "tool_result",
          ),
          ...(Object.hasOwn(tr, "content") ? { content: tr.content } : {}),
        };
      }
      return msg;
    });
  }
  if (data.artifacts != null) {
    const a = object(data.artifacts, "artifacts");
    const artifacts = typedFields(
      a,
      ["workspace_diff", "logs"],
      [],
      "artifacts",
    );
    if (a.generated_files != null) {
      if (
        !Array.isArray(a.generated_files) ||
        a.generated_files.some((v) => v !== null && typeof v !== "string")
      )
        throw new Error("generated_files must be strings");
      artifacts.generated_files = a.generated_files.map((v) => v ?? "");
    }
    if (a.files != null) {
      if (!Array.isArray(a.files))
        throw new Error("artifacts.files must be an array");
      artifacts.files = a.files.map((f) =>
        typedFields(
          f,
          ["name", "path", "url", "content", "content_base64", "content_type"],
          [],
          "artifact",
        ),
      );
    }
    result.artifacts = artifacts;
  }
  return normalizeSessionResult(result as unknown as SessionResult);
}
