// Modified for the skilled TypeScript distribution.
import type { Context } from "@opentelemetry/api";
import type { Agent, SessionResult } from "../agent/types.js";
import type { Transcript } from "../contracts/transcript.js";
import type { EvalConfig } from "../contracts/schema.js";
import type { Loader } from "../config/loader.js";
import type { Resolver, ResolvedAgentConfig } from "../credentials/index.js";
import type { Simulator } from "../usersimulator/index.js";
import type {
  Status,
  Result,
  Outcome,
  SkillInfo,
  ExpectResult,
} from "../judge/types.js";
import type { PlannedTask } from "./plan.js";
export interface ProgressObserver {
  onCaseStart(
    index: number,
    total: number,
    caseID: string,
    title: string,
  ): void;
  onCaseComplete(
    index: number,
    total: number,
    caseID: string,
    status: Status,
    passRate: number,
  ): void;
}
export interface TaskObserver {
  onTaskStart(context: Context, task: PlannedTask): void;
  onTaskComplete(context: Context, task: PlannedTask, result: EvalResult): void;
}
export interface EvalOptions {
  withBaseline?: boolean;
  skillName?: string;
  skillDir?: string;
  outputDir?: string;
  workspaceDir?: string;
  concurrency?: number;
  deleteWorkspace?: boolean;
  loader?: Loader;
  resolver?: Resolver;
  agent?: Agent;
  runnerConfig?: ResolvedAgentConfig;
  simulator?: Simulator;
  evalCfg?: EvalConfig;
  observer?: ProgressObserver;
  taskObserver?: TaskObserver;
}
export type TurnStatus = "completed" | "skipped" | "failed" | "error";
export interface TurnResult {
  turnNumber: number;
  content: string;
  source?: string;
  stopReason?: string;
  response?: string;
  transcript?: Transcript;
  sessionResult?: SessionResult | null;
  status: TurnStatus;
  reason?: string;
  capturedVars?: Record<string, string>;
}
export interface EvalResult extends SessionResult {
  caseID: string;
  caseName: string;
  prompt: string;
  status: Status;
  turnsTotal: number;
  turnResults?: TurnResult[];
  grading?: Result | null;
  judgeResults?: Outcome[];
  aggregationStrategy?: string;
  judgeSession?: SessionResult | null;
  judgeSkills?: SkillInfo[];
  expectResult?: ExpectResult | null;
  error?: Error;
  configuration: string;
}
export type CaseResult = EvalResult;
export class EvaluationError extends Error {
  constructor(
    error: unknown,
    readonly results: EvalResult[],
  ) {
    super(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
    this.name = "EvaluationError";
  }
}
