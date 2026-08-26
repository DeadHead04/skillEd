import { describe, expect, it } from "vitest";
import { parseSkillDocument } from "./frontmatter";

describe("parseSkillDocument", () => {
  it("preserves the Markdown body and recognized metadata", () => {
    const result = parseSkillDocument(
      "---\nname: sample-skill\ndescription: Use for sample tasks.\nmetadata:\n  owner: test\n---\n# Body\n\nExact text.\n",
    );
    expect(result.metadata).toEqual({
      name: "sample-skill",
      description: "Use for sample tasks.",
      metadata: { owner: "test" },
    });
    expect(result.body).toBe("# Body\n\nExact text.\n");
    expect(result.findings).toEqual([]);
  });

  it("reports missing and malformed frontmatter", () => {
    expect(parseSkillDocument("# No frontmatter").findings[0]?.code).toBe(
      "FRONTMATTER_MISSING",
    );
    expect(
      parseSkillDocument("---\nname: [\n---\nBody").findings[0]?.code,
    ).toBe("FRONTMATTER_INVALID");
  });

  it("parses every supported optional field and preserves the body bytes", () => {
    const result = parseSkillDocument(
      "---\r\nname: sample-skill\r\ndescription: Use for sample tasks.\r\nlicense: Apache-2.0\r\ncompatibility: Requires Git.\r\nmetadata:\r\n  owner: team\r\nallowed-tools: Bash(git:*)\r\n---\r\n# Body\r\n\r\nExact CRLF text.\r\n",
    );
    expect(result.metadata).toEqual({
      name: "sample-skill",
      description: "Use for sample tasks.",
      license: "Apache-2.0",
      compatibility: "Requires Git.",
      metadata: { owner: "team" },
      allowedTools: "Bash(git:*)",
    });
    expect(result.body).toBe("# Body\r\n\r\nExact CRLF text.\r\n");
  });

  it("reports invalid published frontmatter types", () => {
    const result = parseSkillDocument(
      "---\nname: 7\ndescription: [bad]\nlicense: false\ncompatibility: 1\nmetadata: []\nallowed-tools: [Bash]\n---\nBody",
    );
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "NAME_INVALID_TYPE",
      "DESCRIPTION_INVALID_TYPE",
      "LICENSE_INVALID_TYPE",
      "COMPATIBILITY_INVALID_TYPE",
      "METADATA_INVALID_TYPE",
      "ALLOWED_TOOLS_INVALID_TYPE",
    ]);
  });
});
