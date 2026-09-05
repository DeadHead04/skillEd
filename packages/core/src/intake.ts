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
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().min(1).max(5000),
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
