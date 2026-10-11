// Modified for the skilled TypeScript distribution.
import type {
  SkillInfo,
  MaterializedContext,
  ContextMaterial,
} from "./types.js";
import { criterionID } from "./agent-response.js";
const judgeIntro =
  'You are an expert evaluator for an AI agent skill evaluation.\nYou must assess the agent\'s output against the following criteria.\nFor EACH criterion, you MUST provide:\n- "criterion_id": the exact stable ID shown below\n- "passed": true/false\n- "evidence": a non-empty JSON array of concrete observations supporting your judgment\n- "failures": an empty JSON array when passed is true, otherwise a non-empty array of unmet requirements\n\nYou MUST NOT pass a criterion without specific evidence.\nThe exact output contract is stated near the end of this prompt under "Required Output Contract"; your final message MUST satisfy it verbatim.\n\n';
const strictOutputRules =
  '\n## Required Output Contract\n- Allowed root field: results.\n- Required result fields with exact casing: criterion_id, passed, evidence, failures.\n- Use every configured criterion_id exactly once.\n- Evidence must be a non-empty string array. Failures must be empty when passed is true and non-empty when passed is false.\n- Your FINAL message must contain ONLY the JSON object, even after you have invoked judge Skills or read the review materials. It must begin with \'{\' and end with \'}\'. Wrapping that single object in one ```json code fence is also accepted.\n- Do NOT begin the final message with any prose, preamble, acknowledgement, or narration (for example "I", "Sure", "Here is", "Based on"). Do NOT add any commentary, explanation, or extra fields before or after the JSON.\n- Escape double quotes inside string values (e.g. \\"example\\").\n';
const skillIntro =
  "## Mandatory Judge Skill Use\nBefore evaluating the case, you MUST invoke the Skill tool for EACH installed judge Skill below using its callable skill name and read the full Skill body. Do not grade the case until you have loaded every listed judge Skill. Do not grade this case using only the inline criteria. The inline criteria identify result dimensions, while the judge Skill(s) define detailed rubric, constraints, and evidence rules. If an inline criterion conflicts with a judge Skill, follow the judge Skill unless the criterion defines a more specific case-level acceptance condition.\n\nInstalled judge Skill(s):\n";
export function buildJudgePrompt(
  criteria: string[],
  materialized: MaterializedContext | null,
  skills: SkillInfo[] = [],
): string {
  return (
    judgeIntro +
    appendJudgeSkillInstructions(skills) +
    "## Criteria\n" +
    criteria.map((c, i) => `[${criterionID(i)}] ${c}\n`).join("") +
    appendReviewMaterials(materialized) +
    appendStrictOutputRules() +
    appendRequiredResponseFormat(criteria)
  );
}
export function buildAgentJudgeCorrectionPrompt(
  criteria: string[],
  validationError: Error,
): string {
  return (
    "## Agent Judge Output Correction\n\n" +
    "Your previous response failed the program-owned output contract. Correct the response using the same evaluation, then re-emit it so that it satisfies the contract below.\n\n" +
    "Validation error (JSON string): " +
    JSON.stringify(validationError.message) +
    "\n\n" +
    appendStrictOutputRules() +
    appendRequiredResponseFormat(criteria)
  );
}
export function buildAgentJudgeFallbackCorrectionPrompt(
  original: string,
  invalid: string,
  correction: string,
): string {
  return (
    "This is a serialized correction retry for a previous agent_judge evaluation.\n\n" +
    "## Original Judge Request\n\n" +
    original +
    "\n\n## Previous Invalid Response (JSON string)\n\n" +
    JSON.stringify(invalid) +
    "\n\n" +
    correction
  );
}
export function appendJudgeSkillInstructions(skills: SkillInfo[]): string {
  if (!skills.length) return "";
  return (
    skillIntro +
    skills
      .map(
        (s) =>
          "- invoke Skill tool with name " +
          JSON.stringify(skillIdentifier(s)) +
          (s.target ? ` (target: ${s.target})` : "") +
          "\n",
      )
      .join("") +
    "\n"
  );
}
export function appendReviewMaterials(
  materialized: MaterializedContext | null,
): string {
  if (!materialized) return "";
  let s =
    "\n## Review Materials\n" +
    "Read files from this table as needed to evaluate the criteria. Evidence must be traceable to the listed material keys or inline excerpts.\n\n" +
    "| key | mode | path | bytes | notes |\n" +
    "| --- | --- | --- | ---: | --- |\n";
  for (const m of materialized.materials)
    s += `| ${materialLabel(m)} | ${m.mode} | ${materialPromptPath(m)} | ${m.original_bytes ?? 0} | ${m.truncated ? "inline excerpt truncated; full text is at path" : ""} |\n`;
  for (const m of materialized.materials) {
    if (!m.inlineContent.trim()) continue;
    s += `\n### Inline Material: ${materialLabel(m)}\n`;
    if (m.truncated)
      s +=
        "The excerpt below is truncated; read the full file at the path above if needed.\n";
    s += "```\n" + m.inlineContent + "\n```\n";
  }
  return s;
}
export function appendStrictOutputRules(): string {
  return strictOutputRules;
}
export function appendRequiredResponseFormat(criteria: string[]): string {
  return (
    "\n## Required Response Format (JSON)\n" +
    "Use each criterion_id exactly once. Set passed and the arrays according to your judgment.\n" +
    '```json\n{\n  "results": [\n' +
    criteria
      .map(
        (_, i) =>
          `    {"criterion_id": ${JSON.stringify(criterionID(i))}, "passed": true, "evidence": ["concrete observation"], "failures": []}`,
      )
      .join(",\n") +
    (criteria.length ? "\n" : "") +
    "  ]\n}\n```\n"
  );
}
export const skillIdentifier = (skill: SkillInfo) =>
  skill.name || skill.path || skill.source || "";
export const materialLabel = (material: ContextMaterial) =>
  material.label ? material.key + ":" + material.label : material.key;
export const materialPromptPath = (material: ContextMaterial) =>
  material.runtimePath || material.path || "";
