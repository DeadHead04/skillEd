export const IMPORT_STATES = [
  "queued",
  "acquiring",
  "scanning",
  "awaiting_selection",
  "persisting",
  "completed",
  "failed",
  "expired",
] as const;

export type ImportState = (typeof IMPORT_STATES)[number];
export type SourceType = "github" | "upload";
export type ValidationStatus = "valid" | "valid_with_warnings" | "invalid";
export type FindingSeverity = "error" | "warning" | "information";
export type FileCategory =
  "instructions" | "reference" | "script" | "asset" | "eval" | "other";

export interface ValidationFinding {
  severity: FindingSeverity;
  code: string;
  message: string;
  relativePath: string;
  line?: number;
}

export interface SkillFileManifest {
  relativePath: string;
  checksum: string;
  byteSize: number;
  category: FileCategory;
  mediaType: string;
}

export interface SkillPackageManifest {
  sourceChecksum: string;
  skillRoot: string;
  skillMdChecksum: string;
  files: SkillFileManifest[];
  validationFindings: ValidationFinding[];
}

export interface ParsedSkillMetadata {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
  extra?: Record<string, unknown>;
}

export interface ImportCandidateView {
  id: string;
  sourcePath: string;
  name: string;
  description: string;
  validationStatus: ValidationStatus;
  findings: ValidationFinding[];
  fileCounts: Record<FileCategory, number>;
  duplicateVersionId?: string;
}

export interface ApiErrorBody {
  error: {
    code:
      | "UNAUTHENTICATED"
      | "WORKSPACE_FORBIDDEN"
      | "GITHUB_NOT_CONNECTED"
      | "REPOSITORY_NOT_FOUND"
      | "REF_NOT_FOUND"
      | "IMPORT_LIMIT_EXCEEDED"
      | "UNSAFE_ARCHIVE"
      | "NO_SKILLS_FOUND"
      | "IMPORT_EXPIRED"
      | "INVALID_SELECTION"
      | "FILE_NOT_PREVIEWABLE"
      | "INTERNAL_ERROR";
    message: string;
  };
}

export const DEFAULT_IMPORT_LIMITS = {
  maxArchiveBytes: 25 * 1024 * 1024,
  maxFiles: 2_000,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxPathDepth: 20,
} as const;

export function fileCounts(
  manifest: Pick<SkillPackageManifest, "files">,
): Record<FileCategory, number> {
  const counts: Record<FileCategory, number> = {
    instructions: 0,
    reference: 0,
    script: 0,
    asset: 0,
    eval: 0,
    other: 0,
  };
  for (const file of manifest.files) counts[file.category] += 1;
  return counts;
}
