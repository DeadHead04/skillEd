import { describe, expect, it } from "vitest";
import { ImportSafetyError } from "./errors";
import { normalizePackagePath } from "./path";

describe("normalizePackagePath", () => {
  it("normalizes safe archive paths", () => {
    expect(normalizePackagePath("skill\\references/guide.md", 20)).toBe(
      "skill/references/guide.md",
    );
  });

  it.each([
    "../secret",
    "/etc/passwd",
    "C:/Windows/file",
    "skill/../../secret",
  ])("rejects escaping path %s", (input) => {
    expect(() => normalizePackagePath(input, 20)).toThrow(ImportSafetyError);
  });

  it("enforces path depth", () => {
    expect(() => normalizePackagePath("a/b/c/file", 3)).toThrowError(
      expect.objectContaining({ code: "IMPORT_LIMIT_EXCEEDED" }),
    );
  });
});
