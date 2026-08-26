import fs from "node:fs/promises";
import path from "node:path";
import type {
  ParsedSkillMetadata,
  ValidationFinding,
  ValidationStatus,
} from "@skilled/domain";

function finding(
  severity: ValidationFinding["severity"],
  code: string,
  message: string,
  relativePath = "SKILL.md",
): ValidationFinding {
  return { severity, code, message, relativePath };
}

export async function validateSkillMetadata(
  root: string,
  metadata: ParsedSkillMetadata,
  body: string,
  initial: ValidationFinding[],
): Promise<ValidationFinding[]> {
  const findings = [...initial];
  const directoryName = path.basename(root);

  if (!metadata.name) {
    findings.push(
      finding(
        "error",
        "NAME_REQUIRED",
        "Frontmatter field 'name' is required.",
      ),
    );
  } else {
    if (
      metadata.name.length > 64 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name)
    ) {
      findings.push(
        finding(
          "error",
          "NAME_INVALID",
          "Name must be 1-64 lowercase letters, numbers, or single hyphens.",
        ),
      );
    }
    if (metadata.name !== directoryName) {
      findings.push(
        finding(
          "error",
          "NAME_DIRECTORY_MISMATCH",
          "Name must match the parent directory name.",
        ),
      );
    }
  }

  if (!metadata.description) {
    findings.push(
      finding(
        "error",
        "DESCRIPTION_REQUIRED",
        "Frontmatter field 'description' is required.",
      ),
    );
  } else if (metadata.description.length > 1024) {
    findings.push(
      finding(
        "error",
        "DESCRIPTION_TOO_LONG",
        "Description must not exceed 1024 characters.",
      ),
    );
  }

  if (metadata.compatibility && metadata.compatibility.length > 500) {
    findings.push(
      finding(
        "error",
        "COMPATIBILITY_TOO_LONG",
        "Compatibility must not exceed 500 characters.",
      ),
    );
  }
  if (
    metadata.metadata &&
    Object.values(metadata.metadata).some((value) => typeof value !== "string")
  ) {
    findings.push(
      finding(
        "error",
        "METADATA_INVALID",
        "Metadata values must all be strings.",
      ),
    );
  }
  if (metadata.allowedTools?.trim()) {
    findings.push(
      finding(
        "information",
        "TOOLS_DECLARED",
        "This Skill declares tools; Phase 1 records but never executes them.",
      ),
    );
  }
  if (metadata.extra && Object.keys(metadata.extra).length > 0) {
    findings.push(
      finding(
        "information",
        "UNKNOWN_FRONTMATTER_FIELDS",
        `Unrecognized fields are preserved: ${Object.keys(metadata.extra).sort().join(", ")}.`,
      ),
    );
  }

  const linkPattern = /(?:\[[^\]]*\]|!\[[^\]]*\])\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of body.matchAll(linkPattern)) {
    const target = match[1];
    if (!target || /^(?:https?:|mailto:|#|data:)/i.test(target)) continue;
    let cleanTarget: string;
    try {
      cleanTarget = decodeURIComponent(target.split("#")[0] ?? target);
    } catch {
      findings.push(
        finding(
          "warning",
          "REFERENCE_INVALID",
          `Relative reference is malformed: ${target}.`,
        ),
      );
      continue;
    }
    const resolved = path.resolve(root, cleanTarget);
    if (
      resolved !== path.resolve(root) &&
      !resolved.startsWith(`${path.resolve(root)}${path.sep}`)
    ) {
      findings.push(
        finding(
          "warning",
          "REFERENCE_ESCAPES_ROOT",
          `Reference escapes the Skill root: ${target}.`,
        ),
      );
      continue;
    }
    try {
      await fs.access(resolved);
    } catch {
      findings.push(
        finding(
          "warning",
          "REFERENCE_MISSING",
          `Broken relative reference: ${target}.`,
        ),
      );
    }
  }

  return findings;
}

export function validationStatus(
  findings: ValidationFinding[],
): ValidationStatus {
  if (findings.some((item) => item.severity === "error")) return "invalid";
  if (findings.length > 0) return "valid_with_warnings";
  return "valid";
}
