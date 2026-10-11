// Modified for the skilled TypeScript distribution.
import type {
  JudgeConfig,
  JudgeContextConfig,
  JudgeContextLimits,
} from "../contracts/schema.js";
import type { Agent, Runtime } from "../agent/types.js";
import type { Judge } from "./types.js";
import { RuleBasedJudge } from "./rule-based.js";
import { ScriptJudge } from "./script.js";
import { newAgentJudgeWithContextAndSkills } from "./agent-judge.js";
import { skillInfosFromRefs } from "./judge-skill.js";
export function newJudge(
  cfg: JudgeConfig,
  ag: Agent | null = null,
  rt: Runtime | null = null,
): Judge | null {
  switch (cfg.type) {
    case "rule_based":
      return new RuleBasedJudge(cfg);
    case "script":
      if (!cfg.script_path)
        throw new Error("script judge requires script_path");
      return new ScriptJudge(cfg.script_path, cfg.timeout_seconds ?? 0, rt);
    case "agent_judge":
      if (!ag) throw new Error("agent_judge requires an Agent");
      return newAgentJudgeWithContextAndSkills(
        ag,
        rt,
        cfg.model,
        cfg.criteria,
        cfg.pass_threshold,
        cfg.context,
        cfg.timeout_seconds ?? 0,
        skillInfosFromRefs(cfg.skills),
      );
    case "":
      return null;
    default:
      throw new Error(`unknown judge type: ${JSON.stringify(cfg.type)}`);
  }
}
export function cloneJudgeContextConfig(
  input: JudgeContextConfig | null,
): JudgeContextConfig | null {
  if (!input) return null;
  return {
    ...input,
    limits: input.limits ? { ...input.limits } : null,
    attachments: input.attachments?.map((a) => ({ ...a })) ?? null,
  };
}
export function mergeJudgeContextLimits(
  global: JudgeContextLimits | null,
  caseLevel: JudgeContextLimits | null,
): JudgeContextLimits | null {
  if (!global && !caseLevel) return null;
  const limits = {
    max_bytes: 0,
    transcript_max_turns: 0,
    workspace_diff_max_lines: 0,
    ...global,
  };
  if (caseLevel)
    for (const key of [
      "max_bytes",
      "transcript_max_turns",
      "workspace_diff_max_lines",
    ] as const)
      if (caseLevel[key] > 0) limits[key] = caseLevel[key];
  return limits;
}
export function mergeJudgeContextConfig(
  global: JudgeContextConfig | null,
  caseLevel: JudgeContextConfig | null,
): JudgeContextConfig | null {
  if (!global) return cloneJudgeContextConfig(caseLevel);
  if (!caseLevel) return cloneJudgeContextConfig(global);
  const merged = cloneJudgeContextConfig(global)!;
  for (const key of [
    "profile",
    "final_message",
    "transcript",
    "workspace_diff",
    "generated_files",
  ] as const)
    if (caseLevel[key]) merged[key] = caseLevel[key];
  merged.limits = mergeJudgeContextLimits(global.limits, caseLevel.limits);
  if (caseLevel.attachments != null)
    merged.attachments = caseLevel.attachments.map((a) => ({ ...a }));
  return merged;
}
export function mergeJudgeConfig(
  global: JudgeConfig,
  caseLevel: JudgeConfig,
): JudgeConfig {
  if (!caseLevel.type) return global;
  return {
    ...caseLevel,
    model: caseLevel.model || global.model,
    pass_threshold: caseLevel.pass_threshold ?? global.pass_threshold,
    timeout_seconds: caseLevel.timeout_seconds ?? global.timeout_seconds,
    context: mergeJudgeContextConfig(global.context, caseLevel.context),
  };
}
