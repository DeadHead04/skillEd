import YAML from "yaml";
import type { ParsedSkillMetadata, ValidationFinding } from "@skilled/domain";

export interface ParsedSkillDocument {
  metadata: ParsedSkillMetadata;
  body: string;
  findings: ValidationFinding[];
}

const KNOWN_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

export function parseSkillDocument(content: string): ParsedSkillDocument {
  const findings: ValidationFinding[] = [];
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(
    content,
  );
  if (!match) {
    return {
      metadata: {},
      body: content,
      findings: [
        {
          severity: "error",
          code: "FRONTMATTER_MISSING",
          message: "SKILL.md must begin with YAML frontmatter.",
          relativePath: "SKILL.md",
          line: 1,
        },
      ],
    };
  }

  const yamlSource = match[1] ?? "";
  const document = YAML.parseDocument(yamlSource, { strict: true });
  if (document.errors.length > 0) {
    return {
      metadata: {},
      body: match[2] ?? "",
      findings: document.errors.map((error) => {
        const line = error.linePos?.[0]?.line;
        return {
          severity: "error" as const,
          code: "FRONTMATTER_INVALID",
          message: error.message.split("\n")[0] ?? "Invalid YAML frontmatter.",
          relativePath: "SKILL.md",
          ...(line ? { line } : {}),
        };
      }),
    };
  }

  const raw = document.toJS() as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    findings.push({
      severity: "error",
      code: "FRONTMATTER_INVALID_TYPE",
      message: "SKILL.md frontmatter must be a mapping.",
      relativePath: "SKILL.md",
      line: 2,
    });
    return { metadata: {}, body: match[2] ?? "", findings };
  }

  const record = raw as Record<string, unknown>;
  const typeChecks: Array<[string, boolean, string]> = [
    [
      "name",
      !("name" in record) || typeof record.name === "string",
      "Name must be a string.",
    ],
    [
      "description",
      !("description" in record) || typeof record.description === "string",
      "Description must be a string.",
    ],
    [
      "license",
      !("license" in record) || typeof record.license === "string",
      "License must be a string.",
    ],
    [
      "compatibility",
      !("compatibility" in record) || typeof record.compatibility === "string",
      "Compatibility must be a string.",
    ],
    [
      "metadata",
      !("metadata" in record) ||
        (record.metadata !== null &&
          typeof record.metadata === "object" &&
          !Array.isArray(record.metadata)),
      "Metadata must be a mapping of string keys to string values.",
    ],
    [
      "allowed-tools",
      !("allowed-tools" in record) ||
        typeof record["allowed-tools"] === "string",
      "Allowed tools must be a string.",
    ],
  ];
  for (const [field, valid, message] of typeChecks) {
    if (!valid) {
      findings.push({
        severity: "error",
        code: `${field.replace("-", "_").toUpperCase()}_INVALID_TYPE`,
        message,
        relativePath: "SKILL.md",
      });
    }
  }
  const extra = Object.fromEntries(
    Object.entries(record).filter(([key]) => !KNOWN_FIELDS.has(key)),
  );
  const metadata: ParsedSkillMetadata = {
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.description === "string"
      ? { description: record.description }
      : {}),
    ...(typeof record.license === "string" ? { license: record.license } : {}),
    ...(typeof record.compatibility === "string"
      ? { compatibility: record.compatibility }
      : {}),
    ...(typeof record["allowed-tools"] === "string"
      ? { allowedTools: record["allowed-tools"] }
      : {}),
    ...(record.metadata &&
    typeof record.metadata === "object" &&
    !Array.isArray(record.metadata)
      ? { metadata: record.metadata as Record<string, string> }
      : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };

  return { metadata, body: match[2] ?? "", findings };
}
