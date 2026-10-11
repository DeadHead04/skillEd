// Modified for the skilled TypeScript distribution.
import { format } from "node:util";
import type { Writable } from "node:stream";
let output: Pick<Writable, "write"> = process.stdout;
export function setOutput(writer: Pick<Writable, "write">): () => void {
  const original = output;
  output = writer;
  return () => {
    output = original;
  };
}
function write(s: string): void {
  try {
    output.write(s);
  } catch {
    /* Progress output is best-effort. */
  }
}
export const step = (emoji: string, message: string): void =>
  write(`${emoji} ${message}\n`);
export const stepf = (emoji: string, f: string, ...a: unknown[]): void =>
  step(emoji, format(f, ...a));
export const status = step;
export const statusf = stepf;
export const caseStart = (
  index: number,
  total: number,
  id: string,
  title: string,
): void => write(`   ⏳ [${index}/${total}] ${id}: ${title}...\n`);
export function caseComplete(
  index: number,
  total: number,
  id: string,
  status: string,
  passRate: number,
): void {
  const emoji: Record<string, string> = {
    PASS: "✅",
    FAIL: "❌",
    ERROR: "⚠️",
    SKIP: "⏭️",
  };
  write(
    `   ${emoji[status.toUpperCase()] || "❓"} [${index}/${total}] ${id}: ${status}${passRate >= 0 ? ` (${(passRate * 100).toFixed(1)}%)` : ""}\n`,
  );
}
export const summary = (
  passed: number,
  failed: number,
  errored: number,
): void =>
  write(`📋 Results: ${passed} passed, ${failed} failed, ${errored} errors\n`);
export const separator = (): void => write(`\n${"─".repeat(40)}\n`);
export const blank = (): void => write("\n");
