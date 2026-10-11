// Modified for the skilled TypeScript distribution.
import type {
  EvalConfig,
  CaseConfig,
  JudgeConfig,
  MCPConfig,
} from "../contracts/schema.js";
export const judgeIDPattern = /^[a-z][a-z0-9_-]{0,63}$/;
export interface JudgePlan {
  judges: JudgeConfig[];
  multi: boolean;
}
export function mergeJudgeConfig(
  global: JudgeConfig,
  local: JudgeConfig,
): JudgeConfig {
  if (!local.type) return structuredClone(global);
  return {
    ...structuredClone(local),
    model: local.model || global.model,
    pass_threshold: local.pass_threshold ?? global.pass_threshold,
    timeout_seconds: local.timeout_seconds ?? global.timeout_seconds,
  };
}
export function resolveJudgePlan(
  evalConfig: EvalConfig,
  caseConfig: CaseConfig,
): JudgePlan {
  for (const [label, cfg] of [
    ["eval", evalConfig],
    ["case", caseConfig],
  ] as const) {
    if (
      (cfg.judgesSet || cfg.judges !== null) &&
      (cfg.judgeSet || cfg.judge.type !== "")
    )
      throw new Error(label + " cannot configure both judge and judges");
  }
  let selected: JudgeConfig[] | null = null;
  if (caseConfig.judgesSet || caseConfig.judges !== null) {
    if (caseConfig.judges === null)
      throw new Error("judges must contain at least one member");
    selected = caseConfig.judges;
  } else if (caseConfig.judgeSet || caseConfig.judge.type !== "") {
    if (evalConfig.judges !== null && !caseConfig.judge.type)
      throw new Error(
        "case judge.type is required when overriding eval judges",
      );
    return {
      judges: [
        evalConfig.judges === null
          ? mergeJudgeConfig(evalConfig.judge, caseConfig.judge)
          : structuredClone(caseConfig.judge),
      ],
      multi: false,
    };
  } else if (evalConfig.judgesSet || evalConfig.judges !== null) {
    if (evalConfig.judges === null)
      throw new Error("judges must contain at least one member");
    selected = evalConfig.judges;
  } else return { judges: [structuredClone(evalConfig.judge)], multi: false };
  if (!selected.length)
    throw new Error("judges must contain at least one member");
  const seen = new Set<string>();
  for (const [i, member] of selected.entries()) {
    if (!judgeIDPattern.test(member.id))
      throw new Error(`judges[${i}].id must be a safe lowercase identifier`);
    if (seen.has(member.id))
      throw new Error(`duplicate judge id ${JSON.stringify(member.id)}`);
    seen.add(member.id);
  }
  return { judges: structuredClone(selected), multi: true };
}
export function mergeCaseMCP(
  evalMCP: MCPConfig,
  caseMCP: MCPConfig,
): MCPConfig {
  const merged = structuredClone(evalMCP);
  if (!caseMCP.servers.length) return merged;
  const index = new Map<string, number>();
  for (const [i, s] of merged.servers.entries()) {
    if (!s.name.trim())
      throw new Error("eval-level mcp server name is required");
    if (index.has(s.name))
      throw new Error(
        `duplicate eval-level mcp server name ${JSON.stringify(s.name)}`,
      );
    index.set(s.name, i);
  }
  const seen = new Set<string>();
  for (const s of caseMCP.servers) {
    if (!s.name) throw new Error("case-level mcp server name is required");
    if (seen.has(s.name))
      throw new Error(
        `duplicate case-level mcp server name ${JSON.stringify(s.name)}`,
      );
    seen.add(s.name);
    if (s.mode !== "mocked")
      throw new Error(
        `case-level mcp server ${JSON.stringify(s.name)} must use mode: mocked`,
      );
    if (s.name !== "filesystem" && !s.config_ref.trim())
      throw new Error(
        `case-level mcp server ${JSON.stringify(s.name)} mocked mode requires config_ref`,
      );
    const i = index.get(s.name);
    if (i === undefined) {
      index.set(s.name, merged.servers.length);
      merged.servers.push(structuredClone(s));
    } else merged.servers[i] = structuredClone(s);
  }
  return merged;
}
