import { DEFAULT_IMPORT_LIMITS } from "@skilled/domain";

export interface ImportLimits {
  maxArchiveBytes: number;
  maxFiles: number;
  maxUncompressedBytes: number;
  maxFileBytes: number;
  maxPathDepth: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function importLimitsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ImportLimits {
  return {
    maxArchiveBytes: positiveInteger(
      env.IMPORT_MAX_ARCHIVE_BYTES,
      DEFAULT_IMPORT_LIMITS.maxArchiveBytes,
    ),
    maxFiles: positiveInteger(
      env.IMPORT_MAX_FILES,
      DEFAULT_IMPORT_LIMITS.maxFiles,
    ),
    maxUncompressedBytes: positiveInteger(
      env.IMPORT_MAX_UNCOMPRESSED_BYTES,
      DEFAULT_IMPORT_LIMITS.maxUncompressedBytes,
    ),
    maxFileBytes: positiveInteger(
      env.IMPORT_MAX_FILE_BYTES,
      DEFAULT_IMPORT_LIMITS.maxFileBytes,
    ),
    maxPathDepth: positiveInteger(
      env.IMPORT_MAX_PATH_DEPTH,
      DEFAULT_IMPORT_LIMITS.maxPathDepth,
    ),
  };
}
