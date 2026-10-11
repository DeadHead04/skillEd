// Modified for the skilled TypeScript distribution.
import type {
  EvalConfig,
  EngineConfig,
  CustomEngineConfig,
} from "../contracts/schema.js";
import { isBuiltinEngineName } from "../contracts/agentkind.js";
import {
  parseTemplateToken,
  requiredError,
  workspaceRelPathSafe,
} from "../contracts/customengine.js";
import { validationError } from "./validator.js";
const builtinTemplateVars = new Set([
  "workspace",
  "prompt",
  "messages",
  "messages_json",
  "session_input",
  "session_input_json",
  "session_id",
  "input_file",
  "output_file",
  "model",
  "model_provider",
  "model_name",
  "api_key",
  "case_id",
  "variant",
  "max_turns",
  "timeout_seconds",
  "kwargs",
  "kwargs_json",
]);
export function isBuiltinTemplateVar(name: string): boolean {
  return name.startsWith("kwargs.") || builtinTemplateVars.has(name);
}
export function isSensitiveEnvName(name: string): boolean {
  return /(^|_)(API_?KEY|ACCESS_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTHORIZATION)(_|$)/i.test(
    name,
  );
}
const secrets = [
  /(?:^|[^A-Za-z0-9_])sk-[A-Za-z0-9_\-]{16,}/,
  /(?:^|[^A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{20,}/,
  /(?:^|[^A-Za-z0-9_])AIza[A-Za-z0-9_\-]{20,}/,
  /(?:^|[^A-Za-z0-9_])xox[abposr]-[A-Za-z0-9\-]{10,}/,
  /(?:^|[^A-Za-z0-9_])(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /(?:^|[^A-Za-z0-9_])ey[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/,
];
export function looksLikeSecret(value: string): boolean {
  return secrets.some((re) => re.test(value));
}
export function normalizeKeyForSensitiveCheck(key: string): string {
  return key
    .replace(/[^\p{L}\p{N}]/gu, "_")
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1_$2")
    .toUpperCase();
}
function sensitiveTemplate(name: string): boolean {
  return (
    [
      "api_key",
      "kwargs",
      "kwargs_json",
      "session_id",
      "session_input",
      "session_input_json",
    ].includes(name) ||
    (name.startsWith("kwargs.") &&
      isSensitiveEnvName(normalizeKeyForSensitiveCheck(name.slice(7))))
  );
}
function resolveOnce(
  value: string,
  strict: boolean,
  env: NodeJS.ProcessEnv,
): string {
  if (!value.includes("${")) {
    if (strict && looksLikeSecret(value))
      throw new Error(
        "value looks like a credential literal; pass secrets via engine.custom.env instead of inline command-line literals",
      );
    return value;
  }
  const out = value.replace(/\$\{([^}]*)\}/g, (whole, inner: string) => {
    const t = parseTemplateToken(inner);
    if (isBuiltinTemplateVar(t.name)) {
      if (strict && sensitiveTemplate(t.name))
        throw new Error(
          `secret-like template variable \${${t.name}} must not be referenced in a command line; pass credentials via engine.custom.env instead`,
        );
      return whole;
    }
    if (strict && isSensitiveEnvName(t.name))
      throw new Error(
        `secret-like environment variable ${JSON.stringify(t.name)} must not be referenced in a command line; pass credentials via engine.custom.env instead`,
      );
    let result: string,
      fromDefault = false;
    if (env[t.name]) result = env[t.name]!;
    else if (t.hasDefault) {
      result = t.default;
      fromDefault = true;
    } else if (t.hasErrForm) throw requiredError(t);
    else
      throw new Error(`environment variable ${t.name} is required but not set`);
    if (strict && looksLikeSecret(result))
      throw new Error(
        fromDefault
          ? `\${${t.name}:-...} default value looks like a credential; pass secrets via engine.custom.env, not as inline command-line defaults`
          : `environment variable ${JSON.stringify(t.name)} resolves to a value that looks like a credential; reference it from engine.custom.env instead of inline in a command line`,
      );
    return result;
  });
  if (strict && looksLikeSecret(out))
    throw new Error(
      "resolved value looks like a credential literal; pass secrets via engine.custom.env instead of inline command-line literals",
    );
  return out;
}
export function resolveEnvRefs(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveOnce(value, false, env);
}
export function resolveEnvRefsStrict(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (let i = 0; i < 10; i++) {
    const result = resolveOnce(value, true, env);
    if (result === value || !result.includes("${")) return result;
    value = result;
  }
  throw new Error(
    "strict env resolution exceeded maximum depth (possible reference cycle)",
  );
}
export function resolveEnvRefsInAny(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  if (typeof value === "string") return resolveEnvRefs(value, env);
  if (Array.isArray(value))
    return value.map((v) => resolveEnvRefsInAny(v, env));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveEnvRefsInAny(v, env)]),
    );
  return value;
}
export interface ResolveCustomEngineOptions {
  skipModelProvider?: boolean;
  skipModelName?: boolean;
  env?: NodeJS.ProcessEnv;
}
export function resolveCustomEngineConfig(
  cfg: EvalConfig,
  options: ResolveCustomEngineOptions = {},
): void {
  const env = options.env ?? process.env;
  const errors: string[] = [];
  function scalar(
    object: Record<string, unknown>,
    key: string,
    prefix: string,
    strict = false,
  ) {
    try {
      object[key] = (strict ? resolveEnvRefsStrict : resolveEnvRefs)(
        String(object[key] ?? ""),
        env,
      );
    } catch (e) {
      errors.push(`${prefix}: ${(e as Error).message}`);
    }
  }
  function map(object: Record<string, string>, prefix: string, strict = false) {
    for (const k of Object.keys(object))
      scalar(object, k, prefix + "." + k, strict);
  }
  if (!options.skipModelProvider)
    scalar(
      cfg.engine.model as unknown as Record<string, unknown>,
      "provider",
      "engine.model.provider",
    );
  if (!options.skipModelName)
    scalar(
      cfg.engine.model as unknown as Record<string, unknown>,
      "name",
      "engine.model.name",
    );
  scalar(
    cfg.engine.model as unknown as Record<string, unknown>,
    "base_url",
    "engine.model.base_url",
  );
  const custom = cfg.engine.custom;
  if (custom && !isBuiltinEngineName(cfg.engine.name)) {
    for (const k of ["transport", "conversation_mode", "response_format"])
      scalar(
        custom as unknown as Record<string, unknown>,
        k,
        "engine.custom." + k,
      );
    map(custom.env, "engine.custom.env");
    map(custom.kwargs, "engine.custom.kwargs", true);
    if (custom.transport === "local" && custom.local) {
      const l = custom.local;
      for (const k of ["command", "cwd", "input_file", "output_file"])
        scalar(
          l as unknown as Record<string, unknown>,
          k,
          "engine.custom.local." + k,
          true,
        );
      l.args.forEach((v, i) => {
        try {
          l.args[i] = resolveEnvRefsStrict(v, env);
        } catch (e) {
          errors.push(
            `engine.custom.local.args[${i}]: ${(e as Error).message}`,
          );
        }
      });
    }
    if (custom.transport === "http" && custom.http) {
      const h = custom.http;
      for (const k of ["url", "method"])
        scalar(
          h as unknown as Record<string, unknown>,
          k,
          "engine.custom.http." + k,
        );
      map(h.headers, "engine.custom.http.headers");
      h.files.forEach((f, i) =>
        scalar(
          f as unknown as Record<string, unknown>,
          "path",
          `engine.custom.http.files[${i}].path`,
        ),
      );
      try {
        h.request_body = resolveEnvRefsInAny(h.request_body, env);
      } catch (e) {
        errors.push(`engine.custom.http.request_body: ${(e as Error).message}`);
      }
    }
  }
  if (errors.length)
    throw new Error(
      "custom engine config errors:\n  - " + errors.join("\n  - "),
    );
  validationError(validateEngine(cfg.engine));
}
export function validateEngine(engine: EngineConfig): string[] {
  if (!engine.name || isBuiltinEngineName(engine.name)) return [];
  if (!engine.custom)
    return [
      `unsupported agent ${JSON.stringify(engine.name)}: missing engine.custom`,
    ];
  return validateCustomEngine(engine.custom);
}
export function validateCustomEngine(c: CustomEngineConfig): string[] {
  const errors: string[] = [];
  if (!c.transport)
    errors.push("engine.custom.transport is required (local or http)");
  else if (c.transport === "local") {
    if (!c.local?.command)
      errors.push(
        "engine.custom.local.command is required when transport is local",
      );
  } else if (c.transport === "http") {
    const h = c.http;
    if (!h?.url)
      errors.push("engine.custom.http.url is required when transport is http");
    if (h) {
      if (h.method && h.method.toUpperCase() !== "POST")
        errors.push(
          `engine.custom.http.method must be POST (got ${JSON.stringify(h.method)})`,
        );
      h.files.forEach((f, i) => {
        if (!workspaceRelPathSafe(f.path))
          errors.push(
            `engine.custom.http.files[${i}].path ${JSON.stringify(f.path)} must be a non-empty relative path inside the workspace (no leading / or ..)`,
          );
      });
    }
  } else
    errors.push(
      `engine.custom.transport must be "local" or "http" (got ${JSON.stringify(c.transport)})`,
    );
  if (
    c.response_format &&
    !["session_result", "text"].includes(c.response_format)
  )
    errors.push(
      `engine.custom.response_format must be one of: session_result, text (got ${JSON.stringify(c.response_format)})`,
    );
  if (
    c.conversation_mode &&
    !["batch", "stateful"].includes(c.conversation_mode)
  )
    errors.push(
      `engine.custom.conversation_mode must be one of: batch, stateful (got ${JSON.stringify(c.conversation_mode)})`,
    );
  else if (c.conversation_mode === "stateful" && c.response_format === "text")
    errors.push(
      "engine.custom.response_format must be session_result when conversation_mode is stateful",
    );
  if (c.timeout_seconds < 0)
    errors.push("engine.custom.timeout_seconds must be non-negative");
  for (const k of Object.keys(c.kwargs))
    if (isBuiltinTemplateVar(k))
      errors.push(
        `engine.custom.kwargs key ${JSON.stringify(k)} collides with a built-in template variable; rename it`,
      );
  return errors;
}
