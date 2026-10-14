// Modified for the skilled TypeScript distribution.
// Generated from the pinned original CLI, report, judge, config and transcript structs.
export const jsonSchemas: Record<
  string,
  {
    alias?: string;
    fields?: {
      name: string;
      target: string;
      type: string;
      optional?: boolean;
    }[];
  }
> = {
  "cli.anthropicEval": {
    fields: [
      {
        name: "id",
        target: "id",
        type: "int",
      },
      {
        name: "prompt",
        target: "prompt",
        type: "string",
      },
      {
        name: "expected_output",
        target: "expected_output",
        type: "string",
      },
      {
        name: "files",
        target: "files",
        type: "[]string",
      },
      {
        name: "expectations",
        target: "expectations",
        type: "[]string",
      },
    ],
  },
  "cli.anthropicEvals": {
    fields: [
      {
        name: "skill_name",
        target: "skill_name",
        type: "string",
      },
      {
        name: "evals",
        target: "evals",
        type: "[]cli.anthropicEval",
      },
    ],
  },
  "cli.judgeDebugInput": {
    fields: [
      {
        name: "case_id",
        target: "case_id",
        type: "string",
      },
      {
        name: "final_message",
        target: "final_message",
        type: "string",
      },
      {
        name: "exit_code",
        target: "exit_code",
        type: "int",
      },
      {
        name: "skill_dir",
        target: "skill_dir",
        type: "string",
        optional: true,
      },
      {
        name: "workspace_path",
        target: "workspace_path",
        type: "string",
        optional: true,
      },
      {
        name: "workspace_diff",
        target: "workspace_diff",
        type: "string",
        optional: true,
      },
      {
        name: "generated_files",
        target: "generated_files",
        type: "[]string",
        optional: true,
      },
      {
        name: "turns_executed",
        target: "turns_executed",
        type: "int",
        optional: true,
      },
      {
        name: "turns_total",
        target: "turns_total",
        type: "int",
        optional: true,
      },
      {
        name: "transcript",
        target: "transcript",
        type: "transcript.Transcript",
        optional: true,
      },
      {
        name: "expect",
        target: "expect",
        type: "*config.Expect",
        optional: true,
      },
      {
        name: "judge",
        target: "judge",
        type: "config.JudgeConfig",
      },
      {
        name: "mock_results",
        target: "mock_results",
        type: "[]judge.CriterionResult",
        optional: true,
      },
    ],
  },
  "config.Expect": {
    fields: [
      {
        name: "must_contain",
        target: "must_contain",
        type: "[]string",
        optional: true,
      },
      {
        name: "must_not_contain",
        target: "must_not_contain",
        type: "[]string",
        optional: true,
      },
      {
        name: "exit_code",
        target: "exit_code",
        type: "*int",
        optional: true,
      },
      {
        name: "files_exist",
        target: "files_exist",
        type: "[]string",
        optional: true,
      },
      {
        name: "files_not_exist",
        target: "files_not_exist",
        type: "[]string",
        optional: true,
      },
      {
        name: "golden_file",
        target: "golden_file",
        type: "string",
        optional: true,
      },
      {
        name: "file_contains",
        target: "file_contains",
        type: "[]config.FileContainsCheck",
        optional: true,
      },
    ],
  },
  "config.FileContainsCheck": {
    fields: [
      {
        name: "path",
        target: "path",
        type: "string",
      },
      {
        name: "content",
        target: "content",
        type: "string",
      },
    ],
  },
  "config.JudgeConfig": {
    fields: [
      {
        name: "id",
        target: "id",
        type: "string",
        optional: true,
      },
      {
        name: "type",
        target: "type",
        type: "string",
      },
      {
        name: "script_path",
        target: "script_path",
        type: "string",
        optional: true,
      },
      {
        name: "model",
        target: "model",
        type: "string",
        optional: true,
      },
      {
        name: "criteria",
        target: "criteria",
        type: "[]string",
        optional: true,
      },
      {
        name: "skills",
        target: "skills",
        type: "[]config.SkillRef",
        optional: true,
      },
      {
        name: "context",
        target: "context",
        type: "*config.JudgeContextConfig",
        optional: true,
      },
      {
        name: "pass_threshold",
        target: "pass_threshold",
        type: "*float64",
        optional: true,
      },
      {
        name: "timeout_seconds",
        target: "timeout_seconds",
        type: "*int",
        optional: true,
      },
      {
        name: "success",
        target: "success",
        type: "[]config.Rule",
        optional: true,
      },
      {
        name: "failure",
        target: "failure",
        type: "[]config.Rule",
        optional: true,
      },
    ],
  },
  "config.JudgeContextAttachment": {
    fields: [
      {
        name: "path",
        target: "path",
        type: "string",
      },
      {
        name: "label",
        target: "label",
        type: "string",
        optional: true,
      },
    ],
  },
  "config.JudgeContextConfig": {
    fields: [
      {
        name: "profile",
        target: "profile",
        type: "string",
        optional: true,
      },
      {
        name: "final_message",
        target: "final_message",
        type: "string",
        optional: true,
      },
      {
        name: "transcript",
        target: "transcript",
        type: "string",
        optional: true,
      },
      {
        name: "workspace_diff",
        target: "workspace_diff",
        type: "string",
        optional: true,
      },
      {
        name: "generated_files",
        target: "generated_files",
        type: "string",
        optional: true,
      },
      {
        name: "limits",
        target: "limits",
        type: "*config.JudgeContextLimits",
        optional: true,
      },
      {
        name: "attachments",
        target: "attachments",
        type: "[]config.JudgeContextAttachment",
        optional: true,
      },
    ],
  },
  "config.JudgeContextLimits": {
    fields: [
      {
        name: "max_bytes",
        target: "max_bytes",
        type: "int",
        optional: true,
      },
      {
        name: "transcript_max_turns",
        target: "transcript_max_turns",
        type: "int",
        optional: true,
      },
      {
        name: "workspace_diff_max_lines",
        target: "workspace_diff_max_lines",
        type: "int",
        optional: true,
      },
    ],
  },
  "config.OutputContainsRule": {
    fields: [
      {
        name: "all",
        target: "all",
        type: "[]string",
        optional: true,
      },
      {
        name: "any",
        target: "any",
        type: "[]string",
        optional: true,
      },
      {
        name: "not",
        target: "not",
        type: "[]string",
        optional: true,
      },
    ],
  },
  "config.OutputMatchesRule": {
    fields: [
      {
        name: "all",
        target: "all",
        type: "[]string",
        optional: true,
      },
      {
        name: "any",
        target: "any",
        type: "[]string",
        optional: true,
      },
      {
        name: "not",
        target: "not",
        type: "[]string",
        optional: true,
      },
    ],
  },
  "config.Rule": {
    fields: [
      {
        name: "output_contains",
        target: "output_contains",
        type: "*config.OutputContainsRule",
        optional: true,
      },
      {
        name: "output_matches",
        target: "output_matches",
        type: "*config.OutputMatchesRule",
        optional: true,
      },
      {
        name: "exit_code",
        target: "exit_code",
        type: "*int",
        optional: true,
      },
      {
        name: "tool_called",
        target: "tool_called",
        type: "*config.ToolCalledRule",
        optional: true,
      },
      {
        name: "files_exist",
        target: "files_exist",
        type: "[]string",
        optional: true,
      },
      {
        name: "files_not_exist",
        target: "files_not_exist",
        type: "[]string",
        optional: true,
      },
      {
        name: "turn_response_contains",
        target: "turn_response_contains",
        type: "*config.TurnResponseContainsRule",
        optional: true,
      },
      {
        name: "turn_response_not_contains",
        target: "turn_response_not_contains",
        type: "*config.TurnResponseNotContainsRule",
        optional: true,
      },
      {
        name: "tool_called_in_turn",
        target: "tool_called_in_turn",
        type: "*config.ToolCalledInTurnRule",
        optional: true,
      },
      {
        name: "tool_not_called_in_turn",
        target: "tool_not_called_in_turn",
        type: "*config.ToolNotCalledInTurnRule",
        optional: true,
      },
    ],
  },
  "config.SkillRef": {
    fields: [
      {
        name: "Source",
        target: "source",
        type: "string",
      },
      {
        name: "Path",
        target: "path",
        type: "string",
      },
      {
        name: "Target",
        target: "target",
        type: "string",
      },
      {
        name: "Include",
        target: "include",
        type: "[]string",
      },
      {
        name: "Exclude",
        target: "exclude",
        type: "[]string",
      },
    ],
  },
  "config.ToolCalledInTurnRule": {
    fields: [
      {
        name: "turn",
        target: "turn",
        type: "int",
      },
      {
        name: "name",
        target: "name",
        type: "string",
      },
      {
        name: "args",
        target: "args",
        type: "map:any",
        optional: true,
      },
    ],
  },
  "config.ToolCalledRule": {
    fields: [
      {
        name: "name",
        target: "name",
        type: "string",
      },
      {
        name: "args",
        target: "args",
        type: "map:any",
        optional: true,
      },
    ],
  },
  "config.ToolNotCalledInTurnRule": {
    fields: [
      {
        name: "turn",
        target: "turn",
        type: "int",
      },
      {
        name: "name",
        target: "name",
        type: "string",
      },
    ],
  },
  "config.TurnResponseContainsRule": {
    fields: [
      {
        name: "turn",
        target: "turn",
        type: "int",
      },
      {
        name: "contains_all",
        target: "contains_all",
        type: "[]string",
        optional: true,
      },
      {
        name: "contains_any",
        target: "contains_any",
        type: "[]string",
        optional: true,
      },
    ],
  },
  "config.TurnResponseNotContainsRule": {
    fields: [
      {
        name: "turn",
        target: "turn",
        type: "int",
      },
      {
        name: "not_contains",
        target: "not_contains",
        type: "[]string",
      },
    ],
  },
  "judge.AssertionResult": {
    fields: [
      { name: "id", target: "id", type: "string", optional: true },
      { name: "skipped", target: "skipped", type: "bool", optional: true },
      {
        name: "text",
        target: "text",
        type: "string",
      },
      {
        name: "passed",
        target: "passed",
        type: "bool",
      },
      {
        name: "evidence",
        target: "evidence",
        type: "string",
      },
    ],
  },
  "judge.ContextManifest": {
    fields: [
      {
        name: "profile",
        target: "profile",
        type: "string",
      },
      {
        name: "materialized_dir",
        target: "materialized_dir",
        type: "string",
        optional: true,
      },
      {
        name: "runtime_dir",
        target: "runtime_dir",
        type: "string",
        optional: true,
      },
      {
        name: "materials",
        target: "materials",
        type: "[]judge.ContextMaterialManifest",
      },
    ],
  },
  "judge.ContextMaterialManifest": {
    fields: [
      {
        name: "key",
        target: "key",
        type: "string",
      },
      {
        name: "label",
        target: "label",
        type: "string",
        optional: true,
      },
      {
        name: "mode",
        target: "mode",
        type: "string",
      },
      {
        name: "path",
        target: "path",
        type: "string",
        optional: true,
      },
      {
        name: "bytes",
        target: "bytes",
        type: "int",
      },
      {
        name: "original_bytes",
        target: "original_bytes",
        type: "int",
        optional: true,
      },
      {
        name: "truncated",
        target: "truncated",
        type: "bool",
        optional: true,
      },
    ],
  },
  "judge.ContextMetadata": {
    fields: [
      {
        name: "profile",
        target: "profile",
        type: "string",
      },
      {
        name: "materialized_dir",
        target: "materialized_dir",
        type: "string",
        optional: true,
      },
      {
        name: "manifest",
        target: "manifest",
        type: "*judge.ContextManifest",
        optional: true,
      },
      {
        name: "prompt_delivery",
        target: "prompt_delivery",
        type: "string",
        optional: true,
      },
      {
        name: "prompt_bytes",
        target: "prompt_bytes",
        type: "int",
        optional: true,
      },
    ],
  },
  "judge.CriterionResult": {
    fields: [
      {
        name: "criterion_id",
        target: "criterion_id",
        type: "string",
      },
      {
        name: "passed",
        target: "passed",
        type: "*bool",
      },
      {
        name: "evidence",
        target: "evidence",
        type: "[]string",
      },
      {
        name: "failures",
        target: "failures",
        type: "[]string",
      },
    ],
  },
  "judge.ExpectFailure": {
    fields: [
      {
        name: "rule",
        target: "rule",
        type: "string",
      },
      {
        name: "detail",
        target: "detail",
        type: "string",
      },
    ],
  },
  "judge.ExpectResult": {
    fields: [
      {
        name: "passed",
        target: "passed",
        type: "bool",
      },
      {
        name: "failures",
        target: "failures",
        type: "[]judge.ExpectFailure",
      },
      {
        name: "configured_rules",
        target: "configured_rules",
        type: "[]string",
      },
    ],
  },
  "judge.Outcome": {
    fields: [
      {
        name: "id",
        target: "id",
        type: "string",
      },
      {
        name: "type",
        target: "type",
        type: "string",
      },
      {
        name: "status",
        target: "status",
        type: "judge.Status",
      },
      {
        name: "result",
        target: "result",
        type: "*judge.Result",
        optional: true,
      },
      {
        name: "error",
        target: "error",
        type: "string",
        optional: true,
      },
      {
        name: "skip_reason",
        target: "skip_reason",
        type: "string",
        optional: true,
      },
      {
        name: "artifacts_dir",
        target: "artifacts_dir",
        type: "string",
        optional: true,
      },
      {
        name: "duration_ms",
        target: "duration_ms",
        type: "int64",
      },
      {
        name: "judge_skills",
        target: "judge_skills",
        type: "[]judge.SkillInfo",
        optional: true,
      },
    ],
  },
  "judge.Result": {
    fields: [
      { name: "scoring_version", target: "scoring_version", type: "string", optional: true },
      { name: "rubric_id", target: "rubric_id", type: "string", optional: true },
      {
        name: "status",
        target: "status",
        type: "judge.Status",
      },
      {
        name: "skip_reason",
        target: "skip_reason",
        type: "*string",
        optional: true,
      },
      {
        name: "error_reason",
        target: "error_reason",
        type: "*string",
        optional: true,
      },
      {
        name: "turns_executed",
        target: "turns_executed",
        type: "int",
      },
      {
        name: "turns_total",
        target: "turns_total",
        type: "int",
      },
      {
        name: "assertion_results",
        target: "assertion_results",
        type: "[]judge.AssertionResult",
      },
      {
        name: "summary",
        target: "summary",
        type: "judge.ResultSummary",
      },
      {
        name: "judge_context",
        target: "judge_context",
        type: "*judge.ContextMetadata",
        optional: true,
      },
    ],
  },
  "judge.ResultSummary": {
    fields: [
      {
        name: "passed",
        target: "passed",
        type: "int",
      },
      {
        name: "failed",
        target: "failed",
        type: "int",
      },
      {
        name: "total",
        target: "total",
        type: "int",
      },
      {
        name: "pass_rate",
        target: "pass_rate",
        type: "float64",
      },
    ],
  },
  "judge.SkillInfo": {
    fields: [
      {
        name: "source",
        target: "source",
        type: "string",
        optional: true,
      },
      {
        name: "path",
        target: "path",
        type: "string",
        optional: true,
      },
      {
        name: "target",
        target: "target",
        type: "string",
        optional: true,
      },
      {
        name: "include",
        target: "include",
        type: "[]string",
        optional: true,
      },
      {
        name: "exclude",
        target: "exclude",
        type: "[]string",
        optional: true,
      },
      {
        name: "name",
        target: "name",
        type: "string",
        optional: true,
      },
    ],
  },
  "judge.Status": {
    alias: "string",
  },
  "report.AgentConfiguration": {
    fields: [
      {
        name: "role",
        target: "role",
        type: "string",
        optional: true,
      },
      {
        name: "engine",
        target: "engine",
        type: "string",
        optional: true,
      },
      {
        name: "protocol",
        target: "protocol",
        type: "string",
        optional: true,
      },
      {
        name: "provider",
        target: "provider",
        type: "string",
        optional: true,
      },
      {
        name: "model",
        target: "model",
        type: "string",
        optional: true,
      },
      {
        name: "version",
        target: "version",
        type: "string",
        optional: true,
      },
    ],
  },
  "report.BenchmarkDelta": {
    fields: [
      {
        name: "pass_rate",
        target: "pass_rate",
        type: "float64",
      },
      {
        name: "time_seconds",
        target: "time_seconds",
        type: "float64",
      },
      {
        name: "input_tokens",
        target: "input_tokens",
        type: "float64",
      },
      {
        name: "output_tokens",
        target: "output_tokens",
        type: "float64",
      },
    ],
  },
  "report.BenchmarkResult": {
    fields: [
      {
        name: "run_summary",
        target: "run_summary",
        type: "report.BenchmarkRunSummary",
      },
    ],
  },
  "report.BenchmarkRunSummary": {
    fields: [
      {
        name: "with_skill",
        target: "with_skill",
        type: "report.BenchmarkStats",
      },
      {
        name: "without_skill",
        target: "without_skill",
        type: "*report.BenchmarkStats",
      },
      {
        name: "delta",
        target: "delta",
        type: "*report.BenchmarkDelta",
      },
    ],
  },
  "report.BenchmarkStats": {
    fields: [
      {
        name: "pass_rate",
        target: "pass_rate",
        type: "report.StatValue",
      },
      {
        name: "time_seconds",
        target: "time_seconds",
        type: "report.StatValue",
      },
      {
        name: "input_tokens",
        target: "input_tokens",
        type: "report.StatValue",
      },
      {
        name: "output_tokens",
        target: "output_tokens",
        type: "report.StatValue",
      },
    ],
  },
  "report.CaseResult": {
    fields: [
      { name: "usage_status", target: "usage_status", type: "string", optional: true },
      {
        name: "case_id",
        target: "case_id",
        type: "string",
      },
      {
        name: "title",
        target: "title",
        type: "string",
      },
      {
        name: "status",
        target: "status",
        type: "judge.Status",
      },
      {
        name: "duration_ms",
        target: "duration_ms",
        type: "int64",
      },
      {
        name: "turns",
        target: "turns",
        type: "int",
      },
      {
        name: "input_tokens",
        target: "input_tokens",
        type: "int",
      },
      {
        name: "output_tokens",
        target: "output_tokens",
        type: "int",
      },
      {
        name: "judge_duration_ms",
        target: "judge_duration_ms",
        type: "int64",
        optional: true,
      },
      {
        name: "judge_input_tokens",
        target: "judge_input_tokens",
        type: "int",
        optional: true,
      },
      {
        name: "judge_output_tokens",
        target: "judge_output_tokens",
        type: "int",
        optional: true,
      },
      {
        name: "error",
        target: "error",
        type: "string",
        optional: true,
      },
      {
        name: "grading",
        target: "grading",
        type: "*judge.Result",
      },
      {
        name: "gates",
        target: "gates",
        type: "*judge.ExpectResult",
        optional: true,
      },
      {
        name: "judge_results",
        target: "judge_results",
        type: "[]judge.Outcome",
        optional: true,
      },
      {
        name: "judge_skills",
        target: "judge_skills",
        type: "[]judge.SkillInfo",
        optional: true,
      },
      {
        name: "configuration",
        target: "configuration",
        type: "string",
        optional: true,
      },
      {
        name: "prompt",
        target: "prompt",
        type: "string",
        optional: true,
      },
      {
        name: "response",
        target: "response",
        type: "string",
        optional: true,
      },
      {
        name: "observed_model",
        target: "observed_model",
        type: "string",
        optional: true,
      },
      {
        name: "observed_version",
        target: "observed_version",
        type: "string",
        optional: true,
      },
      {
        name: "turn_results",
        target: "turn_results",
        type: "[]report.CaseTurnResult",
        optional: true,
      },
    ],
  },
  "report.CaseTurnResult": {
    fields: [
      {
        name: "turn_number",
        target: "turn_number",
        type: "int",
      },
      {
        name: "content",
        target: "content",
        type: "string",
      },
      {
        name: "source",
        target: "source",
        type: "string",
        optional: true,
      },
      {
        name: "response",
        target: "response",
        type: "string",
      },
      {
        name: "status",
        target: "status",
        type: "string",
      },
      {
        name: "reason",
        target: "reason",
        type: "string",
        optional: true,
      },
      {
        name: "stop_reason",
        target: "stop_reason",
        type: "string",
        optional: true,
      },
    ],
  },
  "report.Input": {
    fields: [
      {
        name: "skill_name",
        target: "skill_name",
        type: "string",
      },
      {
        name: "schema_version",
        target: "schema_version",
        type: "string",
      },
      {
        name: "engine_name",
        target: "engine_name",
        type: "string",
      },
      {
        name: "model_name",
        target: "model_name",
        type: "string",
      },
      {
        name: "requested_configuration",
        target: "requested_configuration",
        type: "*report.AgentConfiguration",
        optional: true,
      },
      {
        name: "applied_configuration",
        target: "applied_configuration",
        type: "*report.AgentConfiguration",
        optional: true,
      },
      {
        name: "observed_configuration",
        target: "observed_configuration",
        type: "*report.AgentConfiguration",
        optional: true,
      },
      {
        name: "start_time",
        target: "start_time",
        type: "time.Time",
      },
      {
        name: "end_time",
        target: "end_time",
        type: "time.Time",
      },
      {
        name: "case_results",
        target: "case_results",
        type: "[]report.CaseResult",
      },
      {
        name: "total_tokens",
        target: "total_tokens",
        type: "int",
      },
      {
        name: "judge_tokens",
        target: "judge_tokens",
        type: "int",
      },
      {
        name: "overall_tokens",
        target: "overall_tokens",
        type: "int",
      },
      {
        name: "benchmark",
        target: "benchmark",
        type: "*report.BenchmarkResult",
        optional: true,
      },
    ],
  },
  "report.StatValue": {
    fields: [
      {
        name: "mean",
        target: "mean",
        type: "float64",
      },
      {
        name: "stddev",
        target: "stddev",
        type: "float64",
      },
    ],
  },
  "transcript.Message": {
    fields: [
      {
        name: "role",
        target: "role",
        type: "transcript.Role",
      },
      {
        name: "content",
        target: "content",
        type: "string",
        optional: true,
      },
      {
        name: "turn",
        target: "turn",
        type: "int",
        optional: true,
      },
      {
        name: "tool_call",
        target: "tool_call",
        type: "*transcript.ToolCallInfo",
        optional: true,
      },
      {
        name: "tool_result",
        target: "tool_result",
        type: "*transcript.ToolResultInfo",
        optional: true,
      },
      {
        name: "timestamp",
        target: "timestamp",
        type: "*time.Time",
        optional: true,
      },
    ],
  },
  "transcript.Role": {
    alias: "string",
  },
  "transcript.ToolCallInfo": {
    fields: [
      {
        name: "id",
        target: "id",
        type: "string",
        optional: true,
      },
      {
        name: "name",
        target: "name",
        type: "string",
      },
      {
        name: "arguments",
        target: "arguments",
        type: "map:any",
        optional: true,
      },
    ],
  },
  "transcript.ToolResultInfo": {
    fields: [
      {
        name: "call_id",
        target: "call_id",
        type: "string",
        optional: true,
      },
      {
        name: "status",
        target: "status",
        type: "string",
        optional: true,
      },
      {
        name: "content",
        target: "content",
        type: "any",
        optional: true,
      },
      {
        name: "duration_ms",
        target: "duration_ms",
        type: "int64",
        optional: true,
      },
    ],
  },
  "transcript.Transcript": {
    alias: "[]transcript.Message",
  },
};
