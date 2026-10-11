// Modified for the skilled TypeScript distribution.
import { schemaDescriptors } from "../contracts/schema.js";
const omittedFields: Record<string, string[]> = {
  EvalConfig: ["judges", "user_simulator"],
  Environment: [
    "image",
    "sandbox_template",
    "workspace_mount",
    "env",
    "setup_steps",
    "use_server_proxy",
    "ready_timeout_seconds",
    "sandbox_timeout_seconds",
    "entrypoint",
    "metadata",
    "kwargs",
    "network_policy",
    "allowed_egress",
  ],
  SetupStep: [],
  MCPConfig: [],
  MCPServer: ["transport", "command", "args", "endpoint", "config_ref"],
  SkillRef: ["path", "target", "include", "exclude"],
  EngineConfig: ["version", "entry", "kwargs", "custom"],
  ModelConfig: ["base_url", "params"],
  UserSimulatorModel: ["timeout_seconds"],
  CasesConfig: ["defaults", "parallelism", "retry_policy"],
  CaseDefaults: ["timeout_seconds", "max_turns", "collect_artifacts", "expect"],
  RetryPolicy: ["max_retries", "retry_on"],
  JudgeConfig: [
    "id",
    "script_path",
    "model",
    "criteria",
    "skills",
    "context",
    "pass_threshold",
    "timeout_seconds",
    "success",
    "failure",
  ],
  JudgeContextConfig: [
    "profile",
    "final_message",
    "transcript",
    "workspace_diff",
    "generated_files",
    "limits",
    "attachments",
  ],
  JudgeContextLimits: [
    "max_bytes",
    "transcript_max_turns",
    "workspace_diff_max_lines",
  ],
  JudgeContextAttachment: ["label"],
  Rule: [
    "output_contains",
    "output_matches",
    "exit_code",
    "tool_called",
    "files_exist",
    "files_not_exist",
    "turn_response_contains",
    "turn_response_not_contains",
    "tool_called_in_turn",
    "tool_not_called_in_turn",
  ],
  TurnResponseContainsRule: ["contains_all", "contains_any"],
  TurnResponseNotContainsRule: [],
  ToolCalledInTurnRule: ["args"],
  ToolNotCalledInTurnRule: [],
  OutputContainsRule: ["all", "any", "not"],
  OutputMatchesRule: ["all", "any", "not"],
  ToolCalledRule: ["args"],
  BenchmarkConfig: [],
  ReportConfig: ["formats", "artifacts"],
  CaseConfig: ["judge", "judges", "user_simulator", "mcp", "collect_artifacts"],
  Input: ["prompt", "turns"],
  UserSimulatorScenario: [],
  Turn: ["respond", "post_condition", "capture", "timeout_seconds"],
  PostCondition: [
    "must_contain_any",
    "must_contain_all",
    "must_not_contain",
    "on_fail",
  ],
  CaptureRule: ["pattern", "jsonpath"],
  Context: ["repo_fixture", "git", "files"],
  GitContext: ["init", "checkout", "apply_diff", "remotes"],
  GitRemote: [],
  Constraints: ["timeout_seconds", "max_turns"],
  Expect: [
    "must_contain",
    "must_not_contain",
    "exit_code",
    "files_exist",
    "files_not_exist",
    "golden_file",
    "file_contains",
  ],
  FileContainsCheck: [],
  EvalResult: [],
  APIKeyConfig: [],
  LoadMeta: [],
};
function zero(value: unknown): boolean {
  return (
    value == null ||
    value === "" ||
    value === 0 ||
    value === false ||
    (Array.isArray(value)
      ? !value.length
      : typeof value === "object" && Object.values(value).every(zero))
  );
}
export function yamlConfiguration(type: string, value: unknown): unknown {
  if (type.startsWith("*"))
    return value == null ? null : yamlConfiguration(type.slice(1), value);
  if (type.startsWith("[]"))
    return ((value ?? []) as unknown[]).map((v) =>
      yamlConfiguration(type.slice(2), v),
    );
  if (type.startsWith("map[")) return value ?? {};
  const descriptor = schemaDescriptors[
    type as keyof typeof schemaDescriptors
  ] as Record<string, string> | undefined;
  if (!descriptor) return value;
  const object = value as Record<string, unknown>,
    out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(descriptor)) {
    if (["judgeSet", "judgesSet", "sourceFile"].includes(key)) continue;
    const v = object[key];
    if (
      omittedFields[type]?.includes(key) &&
      (child.startsWith("*") ? v == null : zero(v))
    )
      continue;
    out[key] = yamlConfiguration(child, v);
  }
  return out;
}
