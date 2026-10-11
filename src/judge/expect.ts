// Modified for the skilled TypeScript distribution.
import { readFile } from "node:fs/promises";
import type { Expect, FileContainsCheck } from "../contracts/schema.js";
import {
  resolveInput,
  type Input,
  type ExpectResult,
  type ExpectFailure,
  type AssertionResult,
} from "./types.js";
import {
  safePath,
  fileExistsInWorkspace,
  quote,
  errorMessage,
} from "./helpers.js";
export async function checkExpect(
  expect: Expect | null | undefined,
  input: Input,
): Promise<ExpectResult> {
  if (!expect) return { passed: true, failures: null, configured_rules: null };
  const i = resolveInput(input),
    failures: ExpectFailure[] = [],
    configured: string[] = [];
  const add = (name: string, results: ExpectFailure[]) => {
    configured.push(name);
    failures.push(...results);
  };
  if (expect.must_contain.length)
    add("must_contain", checkMustContain(expect.must_contain, i.finalMessage));
  if (expect.must_not_contain.length)
    add(
      "must_not_contain",
      checkMustNotContain(expect.must_not_contain, i.finalMessage),
    );
  if (expect.exit_code !== null)
    add("exit_code", checkExitCode(expect.exit_code, i.exitCode));
  if (expect.files_exist.length)
    add(
      "files_exist",
      await checkFilesExist(expect.files_exist, i.workspacePath),
    );
  if (expect.files_not_exist.length)
    add(
      "files_not_exist",
      await checkFilesNotExist(expect.files_not_exist, i.workspacePath),
    );
  if (expect.golden_file)
    add(
      "golden_file",
      await checkGoldenFile(
        expect.golden_file,
        i.finalMessage,
        i.skillDir,
        i.workspacePath,
      ),
    );
  if (expect.file_contains.length)
    add(
      "file_contains",
      await checkFileContains(expect.file_contains, i.workspacePath),
    );
  return {
    passed: failures.length === 0,
    failures: failures.length ? failures : null,
    configured_rules: configured.length ? configured : null,
  };
}
export function toAssertionResults(result: ExpectResult): AssertionResult[] {
  return (result.configured_rules ?? []).map((rule) => {
    const details = (result.failures ?? [])
      .filter((f) => f.rule === rule)
      .map((f) => f.detail);
    return {
      text: "expect." + rule,
      passed: !details.length,
      evidence: details.length ? details.join("; ") : "all checks passed",
    };
  });
}
export function checkMustContain(
  words: string[],
  text: string,
): ExpectFailure[] {
  return words
    .filter((w) => !text.includes(w))
    .map((w) => ({
      rule: "must_contain",
      detail: `output does not contain ${quote(w)}`,
    }));
}
export function checkMustNotContain(
  words: string[],
  text: string,
): ExpectFailure[] {
  return words
    .filter((w) => text.includes(w))
    .map((w) => ({
      rule: "must_not_contain",
      detail: `output contains forbidden keyword ${quote(w)}`,
    }));
}
export function checkExitCode(
  expected: number | null,
  actual: number,
): ExpectFailure[] {
  return expected !== null && expected !== actual
    ? [
        {
          rule: "exit_code",
          detail: `expected exit_code ${expected}, got ${actual}`,
        },
      ]
    : [];
}
async function checkFiles(
  files: string[],
  workspace: string,
  inverse: boolean,
): Promise<ExpectFailure[]> {
  const failures: ExpectFailure[] = [];
  const rule = inverse ? "files_not_exist" : "files_exist";
  for (const f of files) {
    try {
      const exists = await fileExistsInWorkspace(workspace, f);
      if (exists === inverse)
        failures.push({
          rule,
          detail: inverse
            ? `file ${quote(f)} should not exist but does`
            : `expected file ${quote(f)} does not exist`,
        });
    } catch (e) {
      failures.push({
        rule,
        detail: `invalid path ${quote(f)}: ${errorMessage(e)}`,
      });
    }
  }
  return failures;
}
export const checkFilesExist = (files: string[], workspace: string) =>
  checkFiles(files, workspace, false);
export const checkFilesNotExist = (files: string[], workspace: string) =>
  checkFiles(files, workspace, true);
export async function checkGoldenFile(
  goldenPath: string,
  message: string,
  skillDir: string,
  workspace: string,
): Promise<ExpectFailure[]> {
  if (!goldenPath) return [];
  let absolute: string;
  try {
    absolute = safePath(skillDir || workspace, goldenPath);
  } catch (e) {
    return [
      {
        rule: "golden_file",
        detail: `invalid golden file path ${quote(goldenPath)}: ${errorMessage(e)}`,
      },
    ];
  }
  let expected: string;
  try {
    expected = (await readFile(absolute, "utf8")).trim();
  } catch (e) {
    return [
      {
        rule: "golden_file",
        detail: `cannot read golden file ${quote(goldenPath)}: ${errorMessage(e)}`,
      },
    ];
  }
  return expected === message.trim()
    ? []
    : [
        {
          rule: "golden_file",
          detail: `output does not match golden file ${quote(goldenPath)}: ${diffHint(expected, message.trim())}`,
        },
      ];
}
export async function checkFileContains(
  checks: FileContainsCheck[],
  workspace: string,
): Promise<ExpectFailure[]> {
  const out: ExpectFailure[] = [];
  for (const f of checks) {
    let abs: string;
    try {
      abs = safePath(workspace, f.path);
    } catch (e) {
      out.push({
        rule: "file_contains",
        detail: `invalid path ${quote(f.path)}: ${errorMessage(e)}`,
      });
      continue;
    }
    let data: string;
    try {
      data = await readFile(abs, "utf8");
    } catch (e) {
      out.push({
        rule: "file_contains",
        detail: `cannot read file ${quote(f.path)}: ${errorMessage(e)}`,
      });
      continue;
    }
    if (!data.includes(f.content))
      out.push({
        rule: "file_contains",
        detail: `file ${quote(f.path)} does not contain ${quote(f.content)}`,
      });
  }
  return out;
}
export function diffHint(expected: string, actual: string): string {
  const e = Buffer.from(expected),
    a = Buffer.from(actual),
    length = Math.min(e.length, a.length);
  for (let i = 0; i < length; i++)
    if (e[i] !== a[i]) {
      const start = Math.max(i - 20, 0),
        end = Math.min(i + 20, length);
      return `first diff at offset ${i}: expected ...${quote(e.subarray(start, end).toString())}... got ...${quote(a.subarray(start, end).toString())}...`;
    }
  return e.length !== a.length
    ? `length mismatch: expected ${e.length} chars, got ${a.length} chars`
    : "unknown diff";
}
