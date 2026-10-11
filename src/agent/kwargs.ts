// Modified for the skilled TypeScript distribution.
import { debugf } from "../logging/index.js";
export const kwargBypassSandbox = "bypass_sandbox";
export const kwargMaxJSONLRecordBytes = "max_jsonl_record_bytes";
export const kwargMaxJSONLOutputBytes = "max_jsonl_output_bytes";
export const kwargEdition = "edition";
const known = new Set([
  kwargBypassSandbox,
  kwargMaxJSONLRecordBytes,
  kwargMaxJSONLOutputBytes,
  kwargEdition,
]);
export function engineKwargBool(
  kwargs: Record<string, string> | undefined,
  key: string,
): boolean {
  return ["1", "t", "T", "true", "TRUE", "True"].includes(
    (kwargs?.[key] ?? "").trim(),
  );
}
export function logUnknownEngineKwargs(
  engine: string,
  kwargs: Record<string, string> = {},
): void {
  for (const key of Object.keys(kwargs)
    .filter((key) => !known.has(key))
    .sort()) {
    debugf(
      "engine kwarg %s is not a recognised key for agent %s; check spelling or see docs",
      JSON.stringify(key),
      JSON.stringify(engine),
    );
  }
}
