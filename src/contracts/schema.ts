// Modified for the skilled TypeScript distribution.
// Schema field names preserve the evaluation document contract.
export type YAMLValue = unknown;
export interface EvalConfig {
  schema_version: string;
  environment: Environment;
  mcp: MCPConfig;
  skills: SkillRef[] | null;
  engine: EngineConfig;
  cases: CasesConfig;
  judge: JudgeConfig;
  judges: JudgeConfig[] | null;
  judgeSet: boolean;
  judgesSet: boolean;
  benchmark: BenchmarkConfig;
  report: ReportConfig;
  user_simulator: UserSimulatorModel;
}
export interface Environment {
  type: string;
  image: string;
  sandbox_template: string;
  workspace_mount: string;
  env: Record<string, string>;
  setup_steps: SetupStep[];
  use_server_proxy: boolean;
  ready_timeout_seconds: number;
  sandbox_timeout_seconds: number;
  entrypoint: string[];
  metadata: Record<string, string>;
  kwargs: Record<string, string>;
  network_policy: string;
  allowed_egress: string[];
}
export interface SetupStep {
  run: string;
}
export interface MCPConfig {
  servers: MCPServer[];
}
export interface MCPServer {
  name: string;
  mode: string;
  transport: string;
  command: string;
  args?: string[];
  endpoint: string;
  config_ref: string;
}
export interface SkillRef {
  source: string;
  path: string;
  target: string;
  include: string[];
  exclude: string[];
}
export interface EngineConfig {
  name: string;
  version: string;
  entry: string;
  model: ModelConfig;
  kwargs: Record<string, string>;
  custom: CustomEngineConfig | null;
}
export interface ModelConfig {
  provider: string;
  name: string;
  base_url: string;
  params: Record<string, string>;
}
export interface UserSimulatorModel {
  provider: string;
  protocol: string;
  model: string;
  timeout_seconds: number;
}
export interface CasesConfig {
  files: string[];
  defaults: CaseDefaults;
  parallelism: number;
  retry_policy: RetryPolicy;
}
export interface CaseDefaults {
  timeout_seconds: number;
  max_turns: number;
  collect_artifacts: string[];
  expect: Expect;
}
export interface RetryPolicy {
  max_retries: number;
  retry_on: string[];
}
export interface JudgeConfig {
  id: string;
  type: string;
  script_path: string;
  model: string;
  criteria: string[];
  skills: SkillRef[];
  context: JudgeContextConfig | null;
  pass_threshold: number | null;
  timeout_seconds: number | null;
  success: Rule[];
  failure: Rule[];
}
export interface JudgeContextConfig {
  profile: string;
  final_message: string;
  transcript: string;
  workspace_diff: string;
  generated_files: string;
  limits: JudgeContextLimits | null;
  attachments: JudgeContextAttachment[] | null;
}
export interface JudgeContextLimits {
  max_bytes: number;
  transcript_max_turns: number;
  workspace_diff_max_lines: number;
}
export interface JudgeContextAttachment {
  path: string;
  label: string;
}
export interface Rule {
  output_contains: OutputContainsRule | null;
  output_matches: OutputMatchesRule | null;
  exit_code: number | null;
  tool_called: ToolCalledRule | null;
  files_exist: string[];
  files_not_exist: string[];
  turn_response_contains: TurnResponseContainsRule | null;
  turn_response_not_contains: TurnResponseNotContainsRule | null;
  tool_called_in_turn: ToolCalledInTurnRule | null;
  tool_not_called_in_turn: ToolNotCalledInTurnRule | null;
}
export interface TurnResponseContainsRule {
  turn: number;
  contains_all: string[];
  contains_any: string[];
}
export interface TurnResponseNotContainsRule {
  turn: number;
  not_contains: string[];
}
export interface ToolCalledInTurnRule {
  turn: number;
  name: string;
  args: Record<string, unknown>;
}
export interface ToolNotCalledInTurnRule {
  turn: number;
  name: string;
}
export interface OutputContainsRule {
  all: string[];
  any: string[];
  not: string[];
}
export interface OutputMatchesRule {
  all: string[];
  any: string[];
  not: string[];
}
export interface ToolCalledRule {
  name: string;
  args: Record<string, unknown>;
}
export interface BenchmarkConfig {
  enabled: boolean;
}
export interface ReportConfig {
  formats: string[];
  artifacts: string[];
}
export interface CaseConfig {
  id: string;
  title: string;
  description: string;
  tag: string;
  input: Input;
  context: Context;
  constraints: Constraints;
  expect: Expect;
  judge: JudgeConfig;
  judges: JudgeConfig[] | null;
  judgeSet: boolean;
  judgesSet: boolean;
  user_simulator: UserSimulatorScenario | null;
  mcp: MCPConfig;
  collect_artifacts: string[];
  sourceFile: string;
}
export interface Input {
  prompt: string;
  turns: Turn[];
}
export interface UserSimulatorScenario {
  scenario: string;
}
export interface Turn {
  role: string;
  content: string;
  respond: string;
  post_condition: PostCondition | null;
  capture: CaptureRule[];
  timeout_seconds: number;
}
export interface PostCondition {
  must_contain_any: string[];
  must_contain_all: string[];
  must_not_contain: string[];
  on_fail: string;
}
export interface CaptureRule {
  variable: string;
  pattern: string;
  jsonpath: string;
}
export interface Context {
  repo_fixture: string;
  git: GitContext | null;
  files: Record<string, string>;
}
export interface GitContext {
  init: boolean;
  checkout: string;
  apply_diff: string;
  remotes: GitRemote[];
}
export interface GitRemote {
  name: string;
  url: string;
}
export interface Constraints {
  timeout_seconds: number;
  max_turns: number;
}
export interface Expect {
  must_contain: string[];
  must_not_contain: string[];
  exit_code: number | null;
  files_exist: string[];
  files_not_exist: string[];
  golden_file: string;
  file_contains: FileContainsCheck[];
}
export interface FileContainsCheck {
  path: string;
  content: string;
}
export interface CustomEngineConfig {
  transport: string;
  conversation_mode: string;
  timeout_seconds: number;
  response_format: string;
  env: Record<string, string>;
  kwargs: Record<string, string>;
  local: LocalConfig | null;
  http: HTTPConfig | null;
}
export interface LocalConfig {
  command: string;
  args: string[];
  cwd: string;
  input_file: string;
  output_file: string;
}
export interface HTTPConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  files: HTTPFile[];
  request_body: unknown;
}
export interface HTTPFile {
  path: string;
  required: boolean | null;
}
export interface UserConfig {
  schema_version: string;
  kind: string;
  telemetry: Telemetry;
  env: Record<string, string>;
  runtime_kwargs: Record<string, Record<string, string>>;
}
export interface Telemetry {
  service_name: string;
  traces_exporter: string;
  traces: TracesConfig;
  resource_attributes: Record<string, string>;
  verbose: boolean | null;
}
export interface TracesConfig {
  endpoint: string;
  protocol: string;
}
export const schemaDescriptors: Record<string, Record<string, string>> = {
  EvalConfig: {
    schema_version: "string",
    environment: "Environment",
    mcp: "MCPConfig",
    skills: "[]SkillRef",
    engine: "EngineConfig",
    cases: "CasesConfig",
    judge: "JudgeConfig",
    judges: "*[]JudgeConfig",
    judgeSet: "bool",
    judgesSet: "bool",
    benchmark: "BenchmarkConfig",
    report: "ReportConfig",
    user_simulator: "UserSimulatorModel",
  },
  Environment: {
    type: "string",
    image: "string",
    sandbox_template: "string",
    workspace_mount: "string",
    env: "map[string]string",
    setup_steps: "[]SetupStep",
    use_server_proxy: "bool",
    ready_timeout_seconds: "int",
    sandbox_timeout_seconds: "int",
    entrypoint: "[]string",
    metadata: "map[string]string",
    kwargs: "map[string]string",
    network_policy: "string",
    allowed_egress: "[]string",
  },
  SetupStep: {
    run: "string",
  },
  MCPConfig: {
    servers: "[]MCPServer",
  },
  MCPServer: {
    name: "string",
    mode: "string",
    transport: "string",
    command: "string",
    args: "[]string",
    endpoint: "string",
    config_ref: "string",
  },
  SkillRef: {
    source: "string",
    path: "string",
    target: "string",
    include: "[]string",
    exclude: "[]string",
  },
  EngineConfig: {
    name: "string",
    version: "string",
    entry: "string",
    model: "ModelConfig",
    kwargs: "map[string]string",
    custom: "*CustomEngineConfig",
  },
  ModelConfig: {
    provider: "string",
    name: "string",
    base_url: "string",
    params: "map[string]string",
  },
  UserSimulatorModel: {
    provider: "string",
    protocol: "string",
    model: "string",
    timeout_seconds: "int",
  },
  CasesConfig: {
    files: "[]string",
    defaults: "CaseDefaults",
    parallelism: "int",
    retry_policy: "RetryPolicy",
  },
  CaseDefaults: {
    timeout_seconds: "int",
    max_turns: "int",
    collect_artifacts: "[]string",
    expect: "Expect",
  },
  RetryPolicy: {
    max_retries: "int",
    retry_on: "[]string",
  },
  JudgeConfig: {
    id: "string",
    type: "string",
    script_path: "string",
    model: "string",
    criteria: "[]string",
    skills: "[]SkillRef",
    context: "*JudgeContextConfig",
    pass_threshold: "*float64",
    timeout_seconds: "*int",
    success: "[]Rule",
    failure: "[]Rule",
  },
  JudgeContextConfig: {
    profile: "string",
    final_message: "string",
    transcript: "string",
    workspace_diff: "string",
    generated_files: "string",
    limits: "*JudgeContextLimits",
    attachments: "[]JudgeContextAttachment",
  },
  JudgeContextLimits: {
    max_bytes: "int",
    transcript_max_turns: "int",
    workspace_diff_max_lines: "int",
  },
  JudgeContextAttachment: {
    path: "string",
    label: "string",
  },
  Rule: {
    output_contains: "*OutputContainsRule",
    output_matches: "*OutputMatchesRule",
    exit_code: "*int",
    tool_called: "*ToolCalledRule",
    files_exist: "[]string",
    files_not_exist: "[]string",
    turn_response_contains: "*TurnResponseContainsRule",
    turn_response_not_contains: "*TurnResponseNotContainsRule",
    tool_called_in_turn: "*ToolCalledInTurnRule",
    tool_not_called_in_turn: "*ToolNotCalledInTurnRule",
  },
  TurnResponseContainsRule: {
    turn: "int",
    contains_all: "[]string",
    contains_any: "[]string",
  },
  TurnResponseNotContainsRule: {
    turn: "int",
    not_contains: "[]string",
  },
  ToolCalledInTurnRule: {
    turn: "int",
    name: "string",
    args: "map[string]any",
  },
  ToolNotCalledInTurnRule: {
    turn: "int",
    name: "string",
  },
  OutputContainsRule: {
    all: "[]string",
    any: "[]string",
    not: "[]string",
  },
  OutputMatchesRule: {
    all: "[]string",
    any: "[]string",
    not: "[]string",
  },
  ToolCalledRule: {
    name: "string",
    args: "map[string]any",
  },
  BenchmarkConfig: {
    enabled: "bool",
  },
  ReportConfig: {
    formats: "[]string",
    artifacts: "[]string",
  },
  CaseConfig: {
    id: "string",
    title: "string",
    description: "string",
    tag: "string",
    input: "Input",
    context: "Context",
    constraints: "Constraints",
    expect: "Expect",
    judge: "JudgeConfig",
    judges: "*[]JudgeConfig",
    judgeSet: "bool",
    judgesSet: "bool",
    user_simulator: "*UserSimulatorScenario",
    mcp: "MCPConfig",
    collect_artifacts: "[]string",
    sourceFile: "string",
  },
  Input: {
    prompt: "string",
    turns: "[]Turn",
  },
  UserSimulatorScenario: {
    scenario: "string",
  },
  Turn: {
    role: "string",
    content: "string",
    respond: "string",
    post_condition: "*PostCondition",
    capture: "[]CaptureRule",
    timeout_seconds: "int",
  },
  PostCondition: {
    must_contain_any: "[]string",
    must_contain_all: "[]string",
    must_not_contain: "[]string",
    on_fail: "string",
  },
  CaptureRule: {
    variable: "string",
    pattern: "string",
    jsonpath: "string",
  },
  Context: {
    repo_fixture: "string",
    git: "*GitContext",
    files: "map[string]string",
  },
  GitContext: {
    init: "bool",
    checkout: "string",
    apply_diff: "string",
    remotes: "[]GitRemote",
  },
  GitRemote: {
    name: "string",
    url: "string",
  },
  Constraints: {
    timeout_seconds: "int",
    max_turns: "int",
  },
  Expect: {
    must_contain: "[]string",
    must_not_contain: "[]string",
    exit_code: "*int",
    files_exist: "[]string",
    files_not_exist: "[]string",
    golden_file: "string",
    file_contains: "[]FileContainsCheck",
  },
  FileContainsCheck: {
    path: "string",
    content: "string",
  },
  CustomEngineConfig: {
    transport: "string",
    conversation_mode: "string",
    timeout_seconds: "int",
    response_format: "string",
    env: "map[string]string",
    kwargs: "map[string]string",
    local: "*LocalConfig",
    http: "*HTTPConfig",
  },
  LocalConfig: {
    command: "string",
    args: "[]string",
    cwd: "string",
    input_file: "string",
    output_file: "string",
  },
  HTTPConfig: {
    url: "string",
    method: "string",
    headers: "map[string]string",
    files: "[]HTTPFile",
    request_body: "any",
  },
  HTTPFile: {
    path: "string",
    required: "*bool",
  },
  UserConfig: {
    schema_version: "string",
    kind: "string",
    telemetry: "Telemetry",
    env: "map[string]string",
    runtime_kwargs: "map[string]Kwargs",
  },
  Telemetry: {
    service_name: "string",
    traces_exporter: "string",
    traces: "TracesConfig",
    resource_attributes: "map[string]string",
    verbose: "*bool",
  },
  TracesConfig: {
    endpoint: "string",
    protocol: "string",
  },
};
