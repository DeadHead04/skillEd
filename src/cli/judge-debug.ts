// Modified for the skilled TypeScript distribution.
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { decode, type JudgeConfig, type Expect } from "../config/index.js";
import {
  RuleBasedJudge,
  ScriptJudge,
  newAgentJudge,
  checkExpect,
  toAssertionResults,
  newResult,
  type Judge,
  type Input,
  type Result,
} from "../judge/index.js";
import type { CriterionResult } from "../judge/agent-response.js";
import type { Agent, SessionResult } from "../agent/types.js";
import type { Transcript } from "../contracts/transcript.js";
import { newInput, newCaseResult } from "../report/index.js";
import { goJSON } from "../report/helpers.js";
import { buildReporter } from "./report.js";
import { parseJSONInput } from "./json-input.js";
import { type CliContext, errorMessage } from "./context.js";
export interface JudgeDebugInput {
  case_id: string;
  final_message: string;
  exit_code: number;
  skill_dir: string;
  workspace_path: string;
  workspace_diff: string;
  generated_files: string[];
  turns_executed: number;
  turns_total: number;
  transcript: Transcript;
  expect: Expect | null;
  judge: JudgeConfig;
  mock_results: CriterionResult[];
}
export function parseJudgeDebugInput(data: string): JudgeDebugInput {
  const value = parseJSONInput<JudgeDebugInput>("cli.judgeDebugInput", data);
  value.expect =
    value.expect == null ? null : decode<Expect>("Expect", value.expect);
  value.judge = decode<JudgeConfig>("JudgeConfig", value.judge);
  value.transcript ??= [];
  value.generated_files ??= [];
  value.mock_results ??= [];
  return value;
}
export function toJudgeInput(d: JudgeDebugInput): Input {
  return {
    caseID: d.case_id,
    finalMessage: d.final_message,
    exitCode: d.exit_code,
    skillDir: d.skill_dir,
    workspacePath: d.workspace_path,
    workspaceDiff: d.workspace_diff,
    generatedFiles: d.generated_files,
    turnsExecuted: d.turns_executed,
    turnsTotal: d.turns_total,
    transcript: d.transcript,
  };
}
// Preserves the original debug-only inline response mode; never used by run.
export class MockJudgeAgent implements Agent {
  constructor(private results: CriterionResult[]) {}
  name(): string {
    return "mock-judge";
  }
  async install(): Promise<void> {}
  async installMCP(): Promise<void> {}
  async installSkill(): Promise<void> {}
  async check(): Promise<void> {}
  async checkCredentials(): Promise<void> {}
  async run(): Promise<SessionResult> {
    return {
      final_message: goJSON({ results: this.results }),
      exit_code: 0,
      duration_ms: 0,
      turns: 0,
    };
  }
}
export function buildMockAgentJudge(
  cfg: JudgeConfig,
  results: CriterionResult[],
): Judge {
  if (!results.length)
    throw new Error(
      "agent_judge in debug mode requires mock_results in JSON input",
    );
  return newAgentJudge(
    new MockJudgeAgent(results),
    null,
    cfg.model,
    cfg.criteria,
    cfg.pass_threshold,
    0,
  );
}
export function buildJudgeFromConfig(
  cfg: JudgeConfig,
  mockResults: CriterionResult[],
  transcriptPath: string,
): Judge {
  switch (cfg.type) {
    case "rule_based":
    case "":
      return new RuleBasedJudge(cfg);
    case "script": {
      if (!cfg.script_path)
        throw new Error("script judge requires script_path");
      const judge = new ScriptJudge(cfg.script_path);
      judge.transcriptPath = transcriptPath;
      return judge;
    }
    case "agent_judge":
      return buildMockAgentJudge(cfg, mockResults);
    default:
      throw new Error(
        `unsupported judge type ${JSON.stringify(cfg.type)} (supported: rule_based, script, agent_judge)`,
      );
  }
}
export async function prepareDebugTranscriptFile(
  input: JudgeDebugInput,
): Promise<{ file: string; cleanup: () => Promise<void> }> {
  if (input.judge.type !== "script" || !input.transcript.length)
    return { file: "", cleanup: async () => {} };
  let directory: string;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "judge-debug-transcript-"));
  } catch (e) {
    throw new Error(`create temp transcript file: ${errorMessage(e)}`, {
      cause: e,
    });
  }
  const file = path.join(directory, "transcript.json"),
    cleanup = async () => {
      await rm(directory, { recursive: true, force: true });
    };
  try {
    await writeFile(file, goJSON(input.transcript), { mode: 0o600 });
  } catch (e) {
    await cleanup();
    throw new Error(`write transcript to temp file: ${errorMessage(e)}`, {
      cause: e,
    });
  }
  return { file, cleanup };
}
export async function evaluateJudgeWithExpect(
  ctx: CliContext,
  j: Judge,
  expect: Expect | null,
  input: Input,
): Promise<Result> {
  const er = await checkExpect(expect, input);
  if (!er.passed) {
    ctx.stderr(
      `[expect] FAIL — ${er.failures?.length ?? 0} checks failed, judge skipped\n`,
    );
    return newResult(
      toAssertionResults(er),
      input.turnsExecuted,
      input.turnsTotal,
    );
  }
  if (expect) ctx.stderr("[expect] PASS — all pre-checks passed\n");
  try {
    return await j.evaluate(input);
  } catch (e) {
    throw new Error(`judge evaluation failed: ${errorMessage(e)}`, {
      cause: e,
    });
  }
}
export async function generateDebugReport(
  ctx: CliContext,
  format: string,
  input: JudgeDebugInput,
  result: Result,
): Promise<void> {
  const { reporter, outputPath } = buildReporter(format, ".");
  const reportInput = newInput({
    skill_name: "judge-debug",
    schema_version: "v1alpha1",
    engine_name: "debug",
    model_name: "local",
    start_time: new Date(Date.now() - 1000),
    end_time: new Date(),
    case_results: [
      newCaseResult({
        case_id: input.case_id,
        title: "Judge debug: " + input.case_id,
        status: result.status,
        duration_ms: 1000,
        turns: input.turns_executed,
        grading: result,
      }),
    ],
  });
  try {
    await reporter.write(reportInput);
  } catch (e) {
    throw new Error(`generate ${format} report: ${errorMessage(e)}`, {
      cause: e,
    });
  }
  ctx.stderr(`[report] ${format} format → ${outputPath}\n`);
}
export function registerJudgeDebugCommand(
  debug: Command,
  ctx: CliContext,
): void {
  debug
    .command("judge")
    .argument("<input.json>")
    .description("Run judge module with a JSON input file")
    .option("--output <path>", "Output path for grading.json", "grading.json")
    .option(
      "--report <format>",
      "Also generate a report after judge evaluation (json, junit, html)",
      "",
    )
    .action(async (file: string, opts) => {
      let data: string;
      try {
        data = await readFile(file, "utf8");
      } catch (e) {
        throw new Error(
          `read input file ${JSON.stringify(file)}: ${errorMessage(e)}`,
          { cause: e },
        );
      }
      let input: JudgeDebugInput;
      try {
        input = parseJudgeDebugInput(data);
      } catch (e) {
        throw new Error(`parse input JSON: ${errorMessage(e)}`, { cause: e });
      }
      const temp = await prepareDebugTranscriptFile(input);
      try {
        const judge = buildJudgeFromConfig(
            input.judge,
            input.mock_results,
            temp.file,
          ),
          result = await evaluateJudgeWithExpect(
            ctx,
            judge,
            input.expect,
            toJudgeInput(input),
          );
        try {
          await writeFile(opts.output, goJSON(result, 2) + "\n", {
            mode: 0o600,
          });
        } catch (e) {
          throw new Error(`write ${opts.output}: ${errorMessage(e)}`, {
            cause: e,
          });
        }
        ctx.stderr(
          `[judge]  ${result.status} — ${result.summary.passed}/${result.summary.total} assertions passed (pass_rate: ${(result.summary.pass_rate * 100).toFixed(1)}%)\n[output] ${opts.output}\n`,
        );
        if (opts.report)
          await generateDebugReport(ctx, opts.report, input, result);
      } finally {
        await temp.cleanup();
      }
    });
}
