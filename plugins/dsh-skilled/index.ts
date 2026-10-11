// Modified for the skilled TypeScript distribution.
// Cordis host services are supplied by the host, not bundled with the plugin.
export interface PluginConfig {
  skilledBin?: string;
  credentialEnv?: string[];
  observer?: { enabled?: boolean; dataDir?: string; hostVersion?: string };
}
interface ReadChunk {
  text: string;
  lossy?: boolean;
  nextOffset: number;
}
interface ProcessHandle {
  collected: {
    stdout?: { readFrom(offset: number): ReadChunk };
    stderr?: { readFrom(offset: number): ReadChunk };
  };
  done: Promise<{ signal?: string; exitCode: number | null }>;
  waitForExit(): Promise<unknown>;
  terminate(): void;
}
interface Execution {
  agent?: { session: { header: { cwd: string } } };
  signal?: AbortSignal;
}
// Tool schemas validate dynamically supplied arguments in the DSH host.
type ToolArgs = Record<string, any>;
interface HostContext {
  skills: { register(value: unknown): void };
  tools: { register(value: unknown): void };
  subprocess: {
    resolveExecutable(
      binary: string,
      env: NodeJS.ProcessEnv,
      signal?: AbortSignal,
    ): Promise<string>;
    spawn(spec: unknown): ProcessHandle;
  };
  jobs: { start(value: unknown): string | number };
  on(
    name: string,
    listener: (
      session: { id: string | number },
      event: import("./lib/observer.js").HostEvent,
    ) => void,
    options: { global: boolean },
  ): void;
}
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  buildRunArgs,
  forwardedEnvironment,
  prepareOutputDirectory,
  resolveWorkspaceFile,
  splitSkillDocument,
  summarizeResult,
} from "./lib/core.js";
import {
  candidateCase,
  collectSkillFeedback,
  compareResults,
  defaultObservationDirectory,
  ObservationCollector,
  ObservationStore,
  stageCandidateCase,
} from "./lib/observer.js";

export const name = "dsh-skilled";
export const inject = ["tools", "skills", "subprocess", "jobs", "sessions"];

const OUTPUT_LIMIT_BYTES = 1024 * 1024;
const SPILL_LIMIT_BYTES = 16 * 1024 * 1024;
const TOOL_GUIDANCE = `
## DeepSeek Harness integration

When the skilled_validate, skilled_run, skilled_summary, and skilled_compare tools are available,
prefer them over assembling equivalent shell commands. Treat a user-provided new
input or scenario as regression evidence for an existing Skill: add or refine a
case, run a baseline before editing the Skill, improve the Skill from observed
failures, and rerun the same case. Preserve the before/after reports. Base
improvements on gaps revealed by the supplied scenario, and never claim improvement
from process exit alone; inspect the per-case status in result.json.
`;

function toolOutput(schema: unknown) {
  return {
    schema,
    render: (_args: unknown, value: unknown) => [
      { type: "text", text: JSON.stringify(value, null, 2) },
    ],
  };
}

function collectOutput(handle: ProcessHandle) {
  const stdout = handle.collected.stdout?.readFrom(0);
  const stderr = handle.collected.stderr?.readFrom(0);
  return {
    stdout: stdout?.text || "",
    stderr: stderr?.text || "",
    truncated: Boolean(stdout?.lossy || stderr?.lossy),
  };
}

async function awaitProcess(handle: ProcessHandle) {
  try {
    const outcome = await handle.done;
    await handle.waitForExit();
    return outcome;
  } catch (error) {
    handle.terminate();
    try {
      await handle.waitForExit();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "subprocess failed and cleanup could not be confirmed",
      );
    }
    throw error;
  }
}

function createJobHooks(handle: ProcessHandle) {
  let stdoutOffset = 0;
  let stderrOffset = 0;
  return {
    cancel() {
      handle.terminate();
    },
    done: awaitProcess(handle)
      .then((outcome) => {
        return {
          status: outcome.signal ? "killed" : "completed",
          detail:
            outcome.exitCode === 0
              ? "evaluation completed"
              : outcome.signal
                ? `signal: ${outcome.signal}`
                : `exit code: ${outcome.exitCode}`,
        };
      })
      .catch((error) => ({
        status: "failed",
        detail: `process error: ${error instanceof Error ? error.message : String(error)}`,
      })),
    readOutput() {
      const stdout = handle.collected.stdout?.readFrom(stdoutOffset);
      const stderr = handle.collected.stderr?.readFrom(stderrOffset);
      stdoutOffset = stdout?.nextOffset ?? stdoutOffset;
      stderrOffset = stderr?.nextOffset ?? stderrOffset;
      const parts = [];
      if (stdout?.text) parts.push(stdout.text);
      if (stderr?.text) parts.push(`[stderr]\n${stderr.text}`);
      if (stdout?.lossy || stderr?.lossy)
        parts.push(
          "[output truncated; inspect the generated report artifacts]",
        );
      return parts.join("\n");
    },
  };
}

function spawnSpec(
  executable: string,
  args: string[],
  workspace: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
) {
  return {
    argv: [executable, ...args],
    cwd: workspace,
    stdio: {
      stdin: "ignore",
      stdout: {
        maxBytes: OUTPUT_LIMIT_BYTES,
        spill: { maxBytes: SPILL_LIMIT_BYTES },
      },
      stderr: {
        maxBytes: OUTPUT_LIMIT_BYTES,
        spill: { maxBytes: SPILL_LIMIT_BYTES },
      },
    },
    graceMs: 5000,
    ...(signal ? { signal } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

export function apply(ctx: HostContext, config: PluginConfig = {}) {
  const skilledBin = config.skilledBin || "skilled";
  const credentialEnv = config.credentialEnv || [];
  const observerConfig = config.observer || {};
  const skillFile = fileURLToPath(
    new URL("./dist/skilled-improve/SKILL.md", import.meta.url),
  );
  const skillDir = dirname(skillFile);
  const skillContent = splitSkillDocument(readFileSync(skillFile, "utf8"));

  ctx.skills.register({
    name: "skilled-improve",
    description:
      "Create, run, diagnose, and iteratively improve Agent Skill evaluations with skilled.",
    source: "bundled",
    resourceBase: { kind: "directory", path: skillDir },
    content: `${TOOL_GUIDANCE}\n${skillContent}`,
  });

  if (observerConfig.enabled === true) {
    const store = new ObservationStore(
      defaultObservationDirectory(observerConfig.dataDir),
    );
    const collector = new ObservationCollector(store, {
      hostVersion: observerConfig.hostVersion || "",
    });
    ctx.on(
      "session/event",
      (session, event) => {
        collector.handle(session, event);
      },
      { global: true },
    );
    registerObservationTools(ctx, store, skilledBin, credentialEnv);
  }

  ctx.tools.register(
    defineTool({
      name: "skilled_validate",
      description:
        "Validate an existing skilled evaluation suite before running it.",
      parameters: {
        eval_path: {
          type: "string",
          description:
            "Workspace-relative eval.yaml path. Defaults to evals/eval.yaml.",
        },
      },
      output: toolOutput({
        type: "object",
        additionalProperties: false,
        properties: {
          exit_code: { type: "integer", required: true },
          stdout: { type: "string", required: true },
          stderr: { type: "string", required: true },
          truncated: { type: "boolean", required: true },
        },
      }),
      async execute(args: ToolArgs, exec: Execution) {
        const workspace = exec.agent?.session.header.cwd || process.cwd();
        const evalFile = resolveWorkspaceFile(
          workspace,
          args.eval_path,
          "eval_path",
        );
        const env = forwardedEnvironment(credentialEnv);
        const executable = await ctx.subprocess.resolveExecutable(
          skilledBin,
          env,
          exec.signal,
        );
        const handle = ctx.subprocess.spawn(
          spawnSpec(
            executable,
            ["validate", evalFile.relative],
            workspace,
            env,
            exec.signal,
          ),
        );
        const outcome = await awaitProcess(handle);
        return { exit_code: outcome.exitCode ?? -1, ...collectOutput(handle) };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "skilled_run",
      description:
        "Start a skilled evaluation as a background job. Use job_output to collect progress and completion.",
      parameters: {
        eval_path: {
          type: "string",
          description:
            "Workspace-relative eval.yaml path. Defaults to evals/eval.yaml.",
        },
        engine: {
          type: "string",
          description: "Optional Agent Engine override.",
        },
        provider: {
          type: "string",
          description: "Optional model provider override.",
        },
        model: { type: "string", description: "Optional model override." },
        runtime: {
          type: "string",
          description:
            "Optional runtime override: none, opensandbox, or docker.",
        },
        include_case_name: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional case-name glob filters. Repeatable values are passed independently.",
        },
        iteration: {
          type: "integer",
          description:
            "Optional non-negative repeat count. Omit it or use 0 to run once and append the next available iteration without overwriting preserved reports.",
        },
        dry_run: {
          type: "boolean",
          description:
            "Validate and show what would run without executing agents.",
        },
      },
      output: toolOutput({
        type: "object",
        additionalProperties: false,
        properties: {
          job_id: { type: "string", required: true },
          eval_path: { type: "string", required: true },
          output_dir: { type: "string", required: true },
        },
      }),
      async execute(args: ToolArgs, exec: Execution) {
        const workspace = exec.agent?.session.header.cwd || process.cwd();
        const evalFile = resolveWorkspaceFile(
          workspace,
          args.eval_path,
          "eval_path",
        );
        const env = forwardedEnvironment(credentialEnv);
        const executable = await ctx.subprocess.resolveExecutable(
          skilledBin,
          env,
          exec.signal,
        );
        const outputDir = prepareOutputDirectory(
          workspace,
          evalFile.absolute,
          randomUUID(),
        );
        const cliArgs = buildRunArgs(evalFile.relative, outputDir, args);
        const jobId = ctx.jobs.start({
          kind: "skilled",
          label: `skilled run ${evalFile.relative}`,
          outputLimitBytes: OUTPUT_LIMIT_BYTES,
          ...(exec.agent ? { owner: exec.agent } : {}),
          run() {
            const handle = ctx.subprocess.spawn(
              spawnSpec(executable, cliArgs, workspace, env),
            );
            return createJobHooks(handle);
          },
        });
        return {
          job_id: String(jobId),
          eval_path: evalFile.relative,
          output_dir: outputDir,
        };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "skilled_summary",
      description:
        "Read per-case statuses from an existing skilled result.json report.",
      parameters: {
        result_path: {
          type: "string",
          required: true,
          description: "Workspace-relative path to result.json.",
        },
      },
      output: toolOutput({
        type: "object",
        additionalProperties: false,
        properties: {
          result_path: { type: "string", required: true },
          total: { type: "integer", required: true },
          passed: { type: "integer", required: true },
          failed: { type: "integer", required: true },
          errors: { type: "integer", required: true },
          skipped: { type: "integer", required: true },
          other: { type: "integer", required: true },
          cases: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                title: { type: "string", required: true },
                configuration: { type: "string", required: true },
                status: { type: "string", required: true },
              },
            },
          },
        },
      }),
      async execute(args: ToolArgs, exec: Execution) {
        const workspace = exec.agent?.session.header.cwd || process.cwd();
        const resultFile = resolveWorkspaceFile(
          workspace,
          args.result_path,
          "result_path",
        );
        const document = JSON.parse(readFileSync(resultFile.absolute, "utf8"));
        return summarizeResult(document, resultFile.relative);
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "skilled_compare",
      description:
        "Compare per-case business statuses from preserved baseline and post-change result.json reports.",
      parameters: {
        before_result_path: {
          type: "string",
          required: true,
          description: "Workspace-relative baseline result.json path.",
        },
        after_result_path: {
          type: "string",
          required: true,
          description: "Workspace-relative post-change result.json path.",
        },
      },
      output: toolOutput({
        type: "object",
        additionalProperties: false,
        properties: {
          before_path: { type: "string", required: true },
          after_path: { type: "string", required: true },
          same_cases: { type: "boolean", required: true },
          cases: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                before: { type: "string", required: true },
                after: { type: "string", required: true },
                changed: { type: "boolean", required: true },
              },
            },
          },
        },
      }),
      async execute(args: ToolArgs, exec: Execution) {
        const workspace = exec.agent?.session.header.cwd || process.cwd();
        const beforeFile = resolveWorkspaceFile(
          workspace,
          args.before_result_path,
          "before_result_path",
        );
        const afterFile = resolveWorkspaceFile(
          workspace,
          args.after_result_path,
          "after_result_path",
        );
        return compareResults(
          JSON.parse(readFileSync(beforeFile.absolute, "utf8")),
          JSON.parse(readFileSync(afterFile.absolute, "utf8")),
          beforeFile.relative,
          afterFile.relative,
        );
      },
    }),
  );
}

function observationTool(
  name: string,
  description: string,
  parameters: unknown,
  execute: (args: ToolArgs, exec: Execution) => Promise<unknown>,
) {
  return defineTool({
    name,
    description,
    parameters,
    output: toolOutput({ type: "object", additionalProperties: true }),
    execute,
  });
}

function registerObservationTools(
  ctx: HostContext,
  store: ObservationStore,
  skilledBin: string,
  credentialEnv: string[],
) {
  ctx.tools.register(
    observationTool(
      "list_skill_observations",
      "List locally stored, explicitly attributed Skill observations.",
      {},
      async () => ({
        observations: store.list().map((item) => ({
          id: item.id,
          skill: item.skill.name,
          review: item.review.status,
          outcome: item.outcome.status,
          observed_at: item.timing.observed_at,
        })),
      }),
    ),
  );
  ctx.tools.register(
    observationTool(
      "get_skill_observation",
      "Read one local Skill observation.",
      { observation_id: { type: "string", required: true } },
      async (args) => store.get(args.observation_id),
    ),
  );
  ctx.tools.register(
    observationTool(
      "collect_skill_feedback",
      "Review paginated observations and unclassified next-turn user follow-ups for one Skill. Follow next_offset to cover all history. Cite observation IDs; describe a pattern only when multiple independent records support it. Follow-ups are candidates, not confirmed feedback.",
      {
        skill_name: { type: "string", required: true },
        offset: { type: "integer" },
        limit: { type: "integer" },
      },
      async (args) =>
        collectSkillFeedback(store, args.skill_name, {
          offset: args.offset ?? 0,
          limit: args.limit ?? 20,
        }),
    ),
  );
  ctx.tools.register(
    observationTool(
      "record_observation_feedback",
      "Attach explicit user feedback to an existing Skill observation.",
      {
        observation_id: { type: "string", required: true },
        sentiment: {
          type: "string",
          enum: ["positive", "negative", "mixed", "neutral"],
        },
        comment: { type: "string" },
      },
      async (args) =>
        store.feedback(
          args.observation_id,
          args.sentiment || "",
          args.comment || "",
        ),
    ),
  );
  ctx.tools.register(
    observationTool(
      "link_observation_report",
      "Attach a validated baseline or post-change result.json report to an observation.",
      {
        observation_id: { type: "string", required: true },
        phase: {
          type: "string",
          enum: ["baseline", "post_change"],
          required: true,
        },
        result_path: {
          type: "string",
          required: true,
          description: "Workspace-relative result.json path.",
        },
      },
      async (args, exec) => {
        const workspace = exec.agent?.session.header.cwd || process.cwd();
        const resultFile = resolveWorkspaceFile(
          workspace,
          args.result_path,
          "result_path",
        );
        const summary = summarizeResult(
          JSON.parse(readFileSync(resultFile.absolute, "utf8")),
          resultFile.relative,
        );
        const observation = store.addEvidence(args.observation_id, {
          kind: `skilled_${args.phase}_report`,
          ref: resultFile.relative,
          summary: `${summary.passed} passed, ${summary.failed} failed, ${summary.errors} errors`,
        });
        return {
          observation_id: observation.id,
          phase: args.phase,
          result_path: resultFile.relative,
          summary,
        };
      },
    ),
  );
  ctx.tools.register(
    observationTool(
      "review_skill_observation",
      "Approve or reject one observation after explicit user review.",
      {
        observation_id: { type: "string", required: true },
        status: {
          type: "string",
          enum: ["approved", "rejected"],
          required: true,
        },
      },
      async (args) => store.review(args.observation_id, args.status),
    ),
  );
  ctx.tools.register(
    observationTool(
      "preview_observation_case",
      "Preview a candidate regression case without writing files.",
      { observation_id: { type: "string", required: true } },
      async (args) => {
        const candidate = candidateCase(store.get(args.observation_id));
        return { case_id: candidate.id, yaml: candidate.yaml };
      },
    ),
  );
  ctx.tools.register(
    observationTool(
      "write_observation_case",
      "Write an approved observation as a candidate case, update eval.yaml, and validate the suite.",
      {
        observation_id: { type: "string", required: true },
        skill_root: {
          type: "string",
          required: true,
          description: "Workspace-relative Skill root.",
        },
      },
      async (args, exec) => {
        const workspace = exec.agent?.session.header.cwd || process.cwd();
        const staged = stageCandidateCase(
          workspace,
          args.skill_root,
          store.get(args.observation_id),
        );
        try {
          const env = forwardedEnvironment(credentialEnv);
          const executable = await ctx.subprocess.resolveExecutable(
            skilledBin,
            env,
            exec.signal,
          );
          const handle = ctx.subprocess.spawn(
            spawnSpec(
              executable,
              ["validate", staged.relativeEvalPath],
              workspace,
              env,
              exec.signal,
            ),
          );
          const outcome = await awaitProcess(handle);
          const output = collectOutput(handle);
          if (outcome.exitCode !== 0) {
            throw new Error(
              `skilled validate failed: ${(output.stderr || output.stdout).trim()}`,
            );
          }
          store.commitApprovedCandidate(
            args.observation_id,
            staged.candidateYaml,
            () => staged.commit(),
          );
          return {
            case_path: staged.casePath,
            eval_path: staged.evalPath,
            validation: "passed",
          };
        } catch (error) {
          staged.rollback();
          throw error;
        }
      },
    ),
  );
}
