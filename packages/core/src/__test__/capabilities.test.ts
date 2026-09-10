import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unsupportedRequirements } from "../capabilities";

describe("runtime capabilities", () => {
  it("accepts tools published by the capability manifest", () => {
    assert.deepEqual(
      unsupportedRequirements([
        "python3",
        "Node.js",
        "openpyxl 3.1.5",
        "python-docx=1.2.0",
        "pypdf 6.1.1",
        "jsonschema=4.25.1",
        "standard library",
        "none",
      ]),
      [],
    );
  });

  it("does not mistake supplied authoring context for runtime dependencies", () => {
    assert.deepEqual(
      unsupportedRequirements([
        "The target Skill directory",
        "Existing target evaluation configuration, if present",
        "skill-up CLI and credentials only if evaluations are run",
        "Skill instructions",
        "uploaded authority material",
      ]),
      [],
    );
  });

  it("continues to reject unavailable and malformed runtime requirements", () => {
    assert.deepEqual(unsupportedRequirements(["pandas", "live MCP", 42]), [
      "pandas",
      "live MCP",
      "42",
    ]);
  });
});
