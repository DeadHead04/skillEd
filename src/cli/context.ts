// Modified for the skilled TypeScript distribution.
import type { Context } from "@opentelemetry/api";
import type { UserConfig, Source } from "../userconfig/index.js";
export interface CliContext {
  signal?: AbortSignal;
  context: Context;
  userConfig: UserConfig;
  sources: Source[];
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}
export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
