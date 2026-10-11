// Modified for the skilled TypeScript distribution.
import path from "node:path";
import type {
  EvalConfig,
  CaseConfig,
  Environment,
  Expect,
  SkillRef,
  JudgeConfig,
  Rule,
  MCPConfig,
  CustomEngineConfig,
  EngineConfig,
  Turn,
  CaptureRule,
} from "../contracts/schema.js";
import { regexError } from "../regex/index.js";
import { isBuiltinEngineName } from "../contracts/agentkind.js";
import { workspaceRelPathSafe } from "../contracts/customengine.js";
import {
  judgeIDPattern,
  mergeJudgeConfig,
  resolveJudgePlan,
} from "./judge-plan.js";
import type { EvalResult } from "./loader.js";
const q = JSON.stringify;
export function validationError(errors: string[]): void {
  if (errors.length)
    throw new Error("validation errors:\n  - " + errors.join("\n  - "));
}
export function validateGlob(pattern: string): boolean {
  let depth = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      if (++i >= pattern.length) return false;
    } else if (c === "[") {
      if (++i >= pattern.length) return false;
      if (pattern[i] === "^" || pattern[i] === "!") i++;
      if (i >= pattern.length || pattern[i] === "]") return false;
      let closed = false;
      for (; i < pattern.length; i++) {
        if (pattern[i] === "\\") i++;
        else if (pattern[i] === "]") {
          closed = true;
          break;
        }
      }
      if (!closed) return false;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth < 0) return false;
  }
  return depth === 0;
}
export function validateCollectArtifacts(
  field: string,
  patterns: string[],
): string[] {
  return patterns.flatMap((p, i) =>
    !p.trim()
      ? [`${field}[${i}] must not be empty`]
      : !validateGlob(p)
        ? [`${field}[${i}] is not a valid glob pattern: ${q(p)}`]
        : [],
  );
}
export function validateSkillRefs(
  field: string,
  refs: SkillRef[] | null,
): string[] {
  const errors: string[] = [];
  (refs ?? []).forEach((r, i) => {
    if (!r.source.trim()) errors.push(`${field}[${i}].source is required`);
    if (!r.path.trim()) errors.push(`${field}[${i}].path is required`);
    for (const kind of ["include", "exclude"] as const)
      r[kind].forEach((pattern, j) => {
        const f = `${field}[${i}].${kind}[${j}]`;
        if (!pattern.trim()) {
          errors.push(f + " must not be empty");
          return;
        }
        if (path.posix.isAbsolute(pattern)) {
          errors.push(f + " must be relative to the skill path");
          return;
        }
        if (pattern.includes("\\")) {
          errors.push(f + " must use '/' as the path separator");
          return;
        }
        if (pattern.split("/").includes(".."))
          errors.push(f + " must not contain a parent-directory segment");
        if (!validateGlob(pattern))
          errors.push(`${f} is not a valid glob pattern: ${q(pattern)}`);
      });
  });
  return errors;
}
export function validateExpect(prefix: string, e: Expect): string[] {
  const errors: string[] = [];
  for (const f of [
    "must_contain",
    "must_not_contain",
    "files_exist",
    "files_not_exist",
  ] as const)
    e[f].forEach((v, i) => {
      if (!v.trim()) errors.push(`${prefix}.${f}[${i}] must not be empty`);
    });
  if (e.golden_file && !e.golden_file.trim())
    errors.push(prefix + ".golden_file must not be empty");
  e.file_contains.forEach((c, i) => {
    if (!c.path.trim())
      errors.push(`${prefix}.file_contains[${i}].path is required`);
    if (!c.content.trim())
      errors.push(`${prefix}.file_contains[${i}].content is required`);
  });
  return errors;
}
export function validateNetworkPolicy(e: Environment): string[] {
  const p = e.network_policy;
  if (!p)
    return e.allowed_egress.length
      ? ["allowed_egress requires network_policy: allow_declared"]
      : [];
  if (!["deny_all", "allow_declared"].includes(p))
    return ["network_policy must be one of: deny_all, allow_declared"];
  if (e.type === "none")
    return [
      "network_policy requires environment.type opensandbox or docker (none cannot enforce network isolation)",
    ];
  if (e.type === "docker" && p === "allow_declared")
    return [
      "network_policy: allow_declared is not supported for environment.type docker (use deny_all or opensandbox)",
    ];
  if (p === "deny_all")
    return e.allowed_egress.length
      ? ["allowed_egress is only valid with network_policy: allow_declared"]
      : [];
  const errors = e.allowed_egress.length
    ? []
    : [
        "network_policy: allow_declared requires a non-empty allowed_egress list",
      ];
  e.allowed_egress.forEach((target, i) => {
    const t = target.trim();
    if (!t) errors.push(`allowed_egress[${i}] must not be empty`);
    else if (/[ /]/.test(t))
      errors.push(
        `allowed_egress[${i}] ${q(target)} must be a bare FQDN or wildcard domain, not a URL`,
      );
  });
  return errors;
}
export function validateJudge(j: JudgeConfig, required = false): string[] {
  const errors: string[] = [];
  if (j.type && !["rule_based", "script", "agent_judge"].includes(j.type))
    errors.push("judge.type must be one of: rule_based, script, agent_judge");
  if (j.skills.length && j.type !== "agent_judge")
    errors.push(
      "judge.skills is only supported when judge.type is agent_judge",
    );
  errors.push(...validateSkillRefs("judge.skills", j.skills));
  if (
    j.pass_threshold !== null &&
    (j.pass_threshold < 0 || j.pass_threshold > 1)
  )
    errors.push("judge.pass_threshold must be between 0.0 and 1.0");
  if (j.context) {
    const c = j.context;
    if (c.profile && !["minimal", "standard"].includes(c.profile))
      errors.push("judge.context.profile must be one of: minimal, standard");
    for (const f of ["final_message", "transcript", "workspace_diff"] as const)
      if (c[f] && !["include", "omit", "truncate", "file_ref"].includes(c[f]))
        errors.push(
          `judge.context.${f} must be one of: include, omit, truncate, file_ref`,
        );
    if (
      c.generated_files &&
      !["omit", "index", "include"].includes(c.generated_files)
    )
      errors.push(
        "judge.context.generated_files must be one of: omit, index, include",
      );
    if (c.limits)
      for (const f of [
        "max_bytes",
        "transcript_max_turns",
        "workspace_diff_max_lines",
      ] as const)
        if (c.limits[f] < 0)
          errors.push(`judge.context.limits.${f} must be non-negative`);
    c.attachments?.forEach((a, i) => {
      if (!a.path.trim())
        errors.push(`judge.context.attachments[${i}].path must not be empty`);
    });
  }
  if (j.timeout_seconds !== null && j.timeout_seconds < 0)
    errors.push("judge.timeout_seconds must be non-negative");
  for (const field of ["success", "failure"] as const)
    j[field].forEach((rule, i) => {
      if (rule.output_matches)
        for (const kind of ["all", "any", "not"] as const)
          rule.output_matches[kind].forEach((pattern, k) => {
            const error = regexError(pattern);
            if (error)
              errors.push(
                `judge.${field}[${i}].output_matches.${kind}[${k}] is invalid regex ${q(pattern)}: ${error}`,
              );
          });
    });
  for (const field of ["success", "failure"] as const)
    j[field].forEach((r, i) => {
      if (
        ![
          r.output_contains,
          r.output_matches,
          r.exit_code,
          r.tool_called,
          r.turn_response_contains,
          r.turn_response_not_contains,
          r.tool_called_in_turn,
          r.tool_not_called_in_turn,
        ].some((v) => v !== null) &&
        !r.files_exist.length &&
        !r.files_not_exist.length
      )
        errors.push(
          `judge.${field}[${i}]: assertion has no recognizable matcher field; supported matchers: output_contains, output_matches, exit_code, tool_called, files_exist, files_not_exist, turn_response_contains, turn_response_not_contains, tool_called_in_turn, tool_not_called_in_turn. Unknown matcher keys are silently dropped during YAML parsing, so this is likely a typo (there is no output_not_contains matcher; use output_contains.not for negation)`,
        );
    });
  if (required) {
    if (j.type === "script" && !j.script_path)
      errors.push("judge.script_path is required when judge.type is script");
    if (j.type === "agent_judge" && !j.model)
      errors.push("judge.model is required when judge.type is agent_judge");
    if (j.type === "agent_judge" && !j.criteria.length)
      errors.push("judge.criteria is required when judge.type is agent_judge");
  }
  return errors;
}
export function validateConfiguredJudges(
  c: Pick<EvalConfig, "judge" | "judges" | "judgeSet" | "judgesSet">,
): string[] {
  const errors = validateJudge(c.judge);
  const seen = new Set<string>();
  if (c.judges !== null) {
    if (!c.judges.length)
      errors.push("judges must contain at least one member");
    for (const [i, m] of c.judges.entries()) {
      if (!m.type) errors.push(`judges[${i}].type is required`);
      if (!judgeIDPattern.test(m.id))
        errors.push(`judges[${i}].id must be a safe lowercase identifier`);
      if (seen.has(m.id))
        errors.push(`judges[${i}].id ${q(m.id)} is duplicated`);
      seen.add(m.id);
      errors.push(...validateJudge(m, true).map((e) => `judges[${i}]: ${e}`));
    }
  }
  if ((c.judgesSet || c.judges !== null) && (c.judgeSet || c.judge.type !== ""))
    errors.push("judge and judges cannot be configured together");
  if (c.judgesSet && c.judges === null)
    errors.push("judges must contain at least one member");
  return errors;
}
export function validatePerTurnRules(rules: Rule[], total: number): string[] {
  const errors: string[] = [];
  for (const r of rules) {
    for (const f of [
      "turn_response_contains",
      "turn_response_not_contains",
      "tool_called_in_turn",
      "tool_not_called_in_turn",
    ] as const) {
      const v = r[f];
      if (!v) continue;
      if (v.turn < 1) errors.push(`${f}.turn must be >= 1`);
      else if (total > 0 && v.turn > total)
        errors.push(`${f}.turn ${v.turn} exceeds total turns ${total}`);
    }
    if (
      r.turn_response_contains &&
      !r.turn_response_contains.contains_all.length &&
      !r.turn_response_contains.contains_any.length
    )
      errors.push(
        "turn_response_contains must specify contains_all or contains_any",
      );
    if (
      r.turn_response_not_contains &&
      !r.turn_response_not_contains.not_contains.length
    )
      errors.push("turn_response_not_contains.not_contains is required");
    if (r.tool_called_in_turn && !r.tool_called_in_turn.name)
      errors.push("tool_called_in_turn.name is required");
    if (r.tool_not_called_in_turn && !r.tool_not_called_in_turn.name)
      errors.push("tool_not_called_in_turn.name is required");
  }
  return errors;
}
function validateJudgeTurnRules(
  judges: JudgeConfig[],
  total: number,
): string[] {
  return judges.flatMap((j, i) =>
    validatePerTurnRules([...j.success, ...j.failure], total).map(
      (e) => `judges[${i}]: ${e}`,
    ),
  );
}
export function validateCaseMCP(m: MCPConfig): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  m.servers.forEach((s, i) => {
    if (!s.name) {
      errors.push(`mcp.servers[${i}].name is required`);
      return;
    }
    if (seen.has(s.name)) {
      errors.push(`mcp.servers[${i}].name ${q(s.name)} is duplicated`);
      return;
    }
    seen.add(s.name);
    const p = `mcp.servers[${i}] (${q(s.name)})`;
    if (s.mode !== "mocked")
      errors.push(p + " must use mode: mocked at case level");
    if (s.mode === "mocked" && s.name !== "filesystem" && !s.config_ref.trim())
      errors.push(p + " mocked mode requires config_ref");
    if (s.transport && s.transport !== "stdio")
      errors.push(p + " mocked mode only supports stdio transport");
    if (s.endpoint) errors.push(p + " mocked mode does not support endpoint");
    if (s.command || s.args?.length)
      errors.push(p + " mocked mode does not support command/args");
  });
  return errors;
}
export function validateCaptureRule(
  turn: number,
  index: number,
  c: CaptureRule,
): string[] {
  const errors: string[] = [];
  const p = `input.turns[${turn}].capture[${index}]`;
  if (!c.variable) errors.push(p + ".variable is required");
  else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.variable))
    errors.push(
      `${p}.variable ${q(c.variable)} must match pattern [A-Za-z_][A-Za-z0-9_]*`,
    );
  if (!c.pattern && !c.jsonpath)
    errors.push(p + " must specify exactly one extractor: pattern or jsonpath");
  else if (c.pattern && c.jsonpath)
    errors.push(
      p + " must specify exactly one extractor: pattern or jsonpath (both set)",
    );
  if (c.pattern) {
    const e = regexError(c.pattern);
    if (e) errors.push(p + ".pattern is invalid regex: " + e);
  }
  return errors;
}
export function validateEvalConfig(c: EvalConfig): void {
  const errors: string[] = [];
  if (!c.schema_version) errors.push("schema_version is required");
  else if (c.schema_version !== "v1alpha1")
    errors.push(`schema_version must be 'v1alpha1', got '${c.schema_version}'`);
  if (!c.environment.type)
    errors.push("environment.type is required (none, opensandbox, docker)");
  else if (!["none", "opensandbox", "docker"].includes(c.environment.type))
    errors.push("environment.type must be one of: none, opensandbox, docker");
  if (c.environment.type === "docker") {
    if (!c.environment.image.trim())
      errors.push(
        "environment.image is required when environment.type is docker",
      );
    const mount = c.environment.workspace_mount.trim();
    if (mount && !path.posix.isAbsolute(mount))
      errors.push(
        `environment.workspace_mount must be absolute when environment.type is docker, got ${q(mount)}`,
      );
  }
  errors.push(...validateNetworkPolicy(c.environment));
  if (!c.engine.name) errors.push("engine.name is required");
  if (!c.cases.files.length)
    errors.push("cases.files must contain at least one case file");
  if (c.cases.retry_policy.max_retries > 10)
    errors.push("cases.retry_policy.max_retries must be <= 10");
  errors.push(
    ...validateCollectArtifacts(
      "cases.defaults.collect_artifacts",
      c.cases.defaults.collect_artifacts,
    ),
    ...validateExpect("cases.defaults.expect", c.cases.defaults.expect),
    ...validateSkillRefs("skills", c.skills),
    ...validateConfiguredJudges(c),
  );
  const u = c.user_simulator;
  if (u.provider || u.model || u.protocol || u.timeout_seconds) {
    if (!u.provider.trim() || !u.model.trim())
      errors.push(
        "user_simulator.provider and user_simulator.model are required",
      );
    if (!["openai", "anthropic"].includes(u.protocol))
      errors.push("user_simulator.protocol must be openai or anthropic");
    if (u.timeout_seconds < 0)
      errors.push("user_simulator.timeout_seconds must be non-negative");
  }
  validationError(errors);
}
export function validateCaseConfig(c: CaseConfig): void {
  const errors: string[] = [];
  if (!c.input.prompt && !c.input.turns.length)
    errors.push("input.prompt or input.turns is required");
  if (c.input.prompt && c.input.turns.length)
    errors.push("input.prompt and input.turns are mutually exclusive");
  if (c.user_simulator && !c.user_simulator.scenario.trim())
    errors.push("user_simulator.scenario is required");
  c.input.turns.forEach((t, i) => {
    const p = `input.turns[${i}]`;
    if (!t.role) errors.push(p + ".role is required");
    else if (t.role !== "user")
      errors.push(`${p}.role must be "user", got ${q(t.role)}`);
    if (!t.content && !t.respond)
      errors.push(p + ".content is required unless respond is set");
    if (t.content && t.respond)
      errors.push(p + ".content and respond are mutually exclusive");
    if (t.respond && !c.user_simulator)
      errors.push(p + ".respond requires user_simulator.scenario");
    if (t.timeout_seconds < 0)
      errors.push(p + ".timeout_seconds must be non-negative");
    const pc = t.post_condition;
    if (pc) {
      if (pc.on_fail && !["fail", "skip_remaining"].includes(pc.on_fail))
        errors.push(
          `${p}.post_condition.on_fail must be empty, "fail", or "skip_remaining", got ${q(pc.on_fail)}`,
        );
      if (
        !pc.must_contain_any.length &&
        !pc.must_contain_all.length &&
        !pc.must_not_contain.length
      )
        errors.push(
          p +
            ".post_condition must include at least one of must_contain_any, must_contain_all, or must_not_contain",
        );
    }
    t.capture.forEach((cr, j) => errors.push(...validateCaptureRule(i, j, cr)));
  });
  errors.push(
    ...validateConfiguredJudges(c),
    ...validatePerTurnRules(
      [...c.judge.success, ...c.judge.failure],
      c.input.turns.length,
    ),
  );
  if (c.judges)
    errors.push(...validateJudgeTurnRules(c.judges, c.input.turns.length));
  errors.push(
    ...validateCollectArtifacts("collect_artifacts", c.collect_artifacts),
    ...validateExpect("expect", c.expect),
    ...validateCaseMCP(c.mcp),
  );
  validationError(errors);
}
export function duplicateCaseErrors(cases: CaseConfig[]): string[] {
  const errors: string[] = [];
  const files = new Map<string, number>();
  const ids = new Map<string, string[]>();
  for (const c of cases) {
    if (c.sourceFile) {
      const p = path.posix.normalize(c.sourceFile);
      files.set(p, (files.get(p) ?? 0) + 1);
    }
    ids.set(c.id, [
      ...(ids.get(c.id) ?? []),
      c.sourceFile || "<unknown source>",
    ]);
  }
  for (const [p, n] of files)
    if (n > 1)
      errors.push(
        `cases.files lists ${q(p)} ${n} times (after path normalization); each case file must appear once`,
      );
  for (const [id, srcs] of ids)
    if (srcs.length > 1)
      errors.push(
        `duplicate case id ${q(id)} used by ${srcs.length} case files: ${srcs.join(", ")}`,
      );
  return errors;
}
export function validateCases(cases: CaseConfig[]): void {
  validationError(duplicateCaseErrors(cases));
  for (const c of cases)
    try {
      validateCaseConfig(c);
    } catch (e) {
      throw new Error(`case ${c.id}: ${(e as Error).message}`, { cause: e });
    }
}
export function validateCasesWithEvalDefaults(
  e: EvalConfig,
  cases: CaseConfig[],
): void {
  validateCases(cases);
  for (const c of cases) {
    if (
      c.user_simulator &&
      (!e.user_simulator.provider ||
        !e.user_simulator.model ||
        !["openai", "anthropic"].includes(e.user_simulator.protocol))
    )
      throw new Error(
        `case ${c.id}: user_simulator requires eval-level provider, protocol: openai or anthropic, and model`,
      );
    let plan;
    try {
      plan = resolveJudgePlan(e, c);
    } catch (error) {
      throw new Error(`case ${c.id}: ${(error as Error).message}`, {
        cause: error,
      });
    }
    if (plan.multi) {
      plan.judges.forEach((m, i) => {
        const errors = validateJudge(m, true);
        if (errors.length)
          throw new Error(`case ${c.id} judges[${i}]: ${errors.join("; ")}`);
      });
      const errors = validateJudgeTurnRules(plan.judges, c.input.turns.length);
      if (errors.length)
        throw new Error(
          `case ${c.id}: validation errors:\n  - ${errors.join("\n  - ")}`,
        );
    } else {
      const j = mergeJudgeConfig(e.judge, c.judge);
      let errors = validateJudge(j, true);
      if (!errors.length)
        errors = validatePerTurnRules(
          [...j.success, ...j.failure],
          c.input.turns.length,
        );
      if (errors.length)
        throw new Error(
          `case ${c.id}: validation errors:\n  - ${errors.join("\n  - ")}`,
        );
    }
  }
}
export function validateAll(result: EvalResult): void {
  validateEvalConfig(result.eval);
  validateCasesWithEvalDefaults(result.eval, result.cases);
}
export class Validator {
  validateEvalConfig = validateEvalConfig;
  validateCaseConfig = validateCaseConfig;
  validateCases = validateCases;
  validateCasesWithEvalDefaults = validateCasesWithEvalDefaults;
  validateAll = validateAll;
}
