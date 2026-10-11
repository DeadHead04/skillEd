// Modified for the skilled TypeScript distribution.
import { fixed } from "./helpers.js";
export const sharedTemplateFuncs = () => ({
  fmtDuration: (ms: number) => fixed(ms / 1000, 1) + "s",
  fmtPercent: (f: number) => fixed(f * 100, 0) + "%",
  fmtPercentSigned: (f: number) => fixed(f * 100, 0, true) + "%",
  passFailClass: (passed: boolean) => (passed ? "pass" : "fail"),
  passFailIcon: (passed: boolean) => (passed ? "&#x2705;" : "&#x274C;"),
  notNil: (v: unknown) => v != null,
  derefFloat: (f: number | null | undefined) => f ?? 0,
});
