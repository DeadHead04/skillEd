import { parseDocument } from "yaml";
import { z } from "zod";
export function parseSkillMetadata(text: string) {
  const head = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!head) throw new Error("SKILL.md requires YAML frontmatter");
  const document = parseDocument(head[1]!, { uniqueKeys: true });
  if (document.errors.length)
    throw new Error(
      `Invalid Skill frontmatter: ${document.errors[0]?.message}`,
    );
  return z
    .object({
      name: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      description: z.string().trim().min(1).max(1024),
      license: z.string().optional(),
      compatibility: z.string().min(1).max(500).optional(),
      metadata: z.record(z.string(), z.string()).optional(),
      "allowed-tools": z.string().optional(),
    })
    .parse(document.toJS({ maxAliasCount: 20 }));
}
export function excludedPackagePath(path: string) {
  return (
    /(^|\/)(evals?|runs?|outputs?|test-results|\.git|\.svn|\.hg|\.env[^/]*|\.skill-up\.ya?ml|auth\.json|__MACOSX|node_modules)(\/|$)/i.test(
      path,
    ) || /(^|\/)(\.DS_Store|.*\.tmp)$/.test(path)
  );
}

export function materialVisibility(
  kind: string,
  value?: unknown,
): "agent_input" | "judge_only" {
  const visibility =
    value === undefined || value === ""
      ? kind === "dataset"
        ? "agent_input"
        : "judge_only"
      : z.enum(["agent_input", "judge_only"]).parse(value);
  if (kind === "expected" && visibility !== "judge_only")
    throw new Error("Expected answers must remain judge-only");
  return visibility;
}
