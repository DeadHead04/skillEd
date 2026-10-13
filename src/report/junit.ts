// Modified for the skilled TypeScript distribution.
import {
  type Input,
  type CaseResult,
  type Reporter,
  primaryCaseResults,
  totalDuration,
  rfc3339,
} from "./reporter.js";
import { fixed, writeToOutput } from "./helpers.js";
export interface JUnitProperty {
  name: string;
  value: string;
}
export interface JUnitDetail {
  message: string;
  type: string;
  body: string;
}
export interface JUnitTestCase {
  name: string;
  classname: string;
  time: string;
  properties: JUnitProperty[];
  failure?: JUnitDetail;
  error?: JUnitDetail;
  skipped?: { message: string };
}
export interface JUnitTestSuite {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: string;
  timestamp: string;
  testcases: JUnitTestCase[];
}
export interface JUnitTestSuites {
  suites: JUnitTestSuite[];
}
export function buildJudgeSkillProperties(c: CaseResult): JUnitProperty[] {
  const props = [
    { name: "judge.skills.count", value: String(c.judge_skills?.length ?? 0) },
  ];
  for (const [i, s] of (c.judge_skills ?? []).entries()) {
    const prefix = `judge.skills.${i}.`;
    for (const key of [
      "source",
      "path",
      "target",
      "include",
      "exclude",
      "name",
    ] as const)
      props.push({
        name: prefix + key,
        value: Array.isArray(s[key])
          ? (s[key] as string[]).join(",")
          : ((s[key] as string | undefined) ?? ""),
      });
  }
  return props;
}
export function buildFailureBody(c: CaseResult): string {
  if (!c.grading && !c.judge_results?.length) return "";
  const lines: string[] = [];
  for (const f of c.gates?.failures ?? [])
    lines.push(`- gate ${f.rule}: ${f.detail}`);
  for (const m of c.judge_results ?? [])
    lines.push(`- judge ${m.id} (${m.type}): ${m.status} ${m.error ?? ""}`);
  for (const a of c.grading?.assertion_results ?? [])
    if (!a.passed) lines.push(`- ${a.skipped ? "SKIPPED: " : ""}${a.text}: ${a.evidence}`);
  for (const t of c.turn_results ?? [])
    if (t.status !== "completed")
      lines.push(
        `- turn ${t.turn_number}: status=${t.status} reason=${t.reason ?? ""}`,
      );
  return lines.join("\n");
}
export function buildTestSuite(input: Input): JUnitTestSuites {
  let failures = 0,
    errors = 0,
    skipped = 0;
  const cases = primaryCaseResults(input).map((c) => {
    const tc: JUnitTestCase = {
      name: c.case_id,
      classname: input.skill_name,
      time: fixed(c.duration_ms / 1000, 3),
      properties: buildJudgeSkillProperties(c),
    };
    if (c.status === "FAIL") {
      failures++;
      tc.failure = {
        message: `case ${c.case_id} failed`,
        type: "AssertionFailure",
        body: buildFailureBody(c),
      };
    } else if (c.status === "ERROR") {
      errors++;
      const msg = c.error || c.grading?.error_reason || "";
      tc.error = { message: msg, type: "ExecutionError", body: msg };
    } else if (c.status === "SKIP") {
      skipped++;
      tc.skipped = { message: c.grading?.skip_reason ?? "" };
    }
    return tc;
  });
  return {
    suites: [
      {
        name: input.skill_name,
        tests: cases.length,
        failures,
        errors,
        skipped,
        time: fixed(totalDuration(input) / 1000, 3),
        timestamp: rfc3339(input.start_time),
        testcases: cases,
      },
    ],
  };
}
export const xmlEscape = (value: string): string =>
  value.replace(
    /[&<>"'\t\n\r]|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&#34;",
        "'": "&#39;",
        "\t": "&#x9;",
        "\n": "&#xA;",
        "\r": "&#xD;",
      })[c] ?? "�",
  );
export function renderJUnit(input: Input): string {
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>';
  for (const s of buildTestSuite(input).suites) {
    out += `\n  <testsuite name="${xmlEscape(s.name)}" tests="${s.tests}" failures="${s.failures}" errors="${s.errors}" skipped="${s.skipped}" time="${s.time}" timestamp="${xmlEscape(s.timestamp)}">`;
    for (const c of s.testcases) {
      out += `\n    <testcase name="${xmlEscape(c.name)}" classname="${xmlEscape(c.classname)}" time="${c.time}">\n      <properties>`;
      for (const p of c.properties)
        out += `\n        <property name="${xmlEscape(p.name)}" value="${xmlEscape(p.value)}"></property>`;
      out += "\n      </properties>";
      for (const [key, detail] of [
        ["failure", c.failure],
        ["error", c.error],
      ] as const)
        if (detail)
          out += `\n      <${key} message="${xmlEscape(detail.message)}" type="${detail.type}">${xmlEscape(detail.body)}</${key}>`;
      if (c.skipped)
        out += `\n      <skipped${c.skipped.message ? ' message="' + xmlEscape(c.skipped.message) + '"' : ""}></skipped>`;
      out += "\n    </testcase>";
    }
    out += (s.testcases.length ? "\n  " : "") + "</testsuite>";
  }
  return out + "\n</testsuites>";
}
export class JUnitReporter implements Reporter {
  constructor(public outputPath = "") {}
  buildTestSuite(input: Input): JUnitTestSuites {
    return buildTestSuite(input);
  }
  async write(input: Input, _signal?: AbortSignal): Promise<void> {
    await writeToOutput(this.outputPath, "junit report", renderJUnit(input));
  }
}
