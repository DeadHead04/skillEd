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

  it("accepts a dependency-free plain-text task description", () => {
    assert.deepEqual(
      unsupportedRequirements([
        "No external tools or packages are required; plain-text generation is sufficient.",
        "A language-model runtime able to read user-provided clause text.",
        "No external tools, packages, network access, MCP services, or files are required by the tested agent.",
      ]),
      [],
    );
  });

  it("continues to reject unavailable and malformed runtime requirements", () => {
    assert.deepEqual(
      unsupportedRequirements([
        "pandas",
        "live MCP",
        "No external tools or packages are required; plain-text generation is sufficient; live MCP is also required",
        "A language-model runtime able to read user-provided clause text and access the network.",
        42,
      ]),
      [
        "pandas",
        "live MCP",
        "No external tools or packages are required; plain-text generation is sufficient; live MCP is also required",
        "A language-model runtime able to read user-provided clause text and access the network.",
        "42",
      ],
    );
  });
});
