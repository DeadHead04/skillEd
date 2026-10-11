import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileRegex } from "../../src/regex/index.js";
const vectors: Array<{
  pattern: string;
  text: string;
  expected: {
    valid: boolean;
    matches?: boolean;
    groups?: string[] | null;
    names?: string[];
  };
}> = JSON.parse(
  await readFile(
    new URL("../../../tests/config/regex-reference.json", import.meta.url),
    "utf8",
  ),
);
for (const [i, v] of vectors.entries())
  test(`Go regex ${i + 1} ${JSON.stringify(v.pattern)}`, () => {
    let regex;
    try {
      regex = compileRegex(v.pattern);
    } catch {}
    assert.equal(!!regex, v.expected.valid);
    if (regex) {
      assert.deepEqual(regex.subexpNames, v.expected.names);
      assert.equal(regex.test(v.text), v.expected.matches);
      const match = regex.exec(v.text);
      assert.deepEqual(
        match ? Array.from(match, (x) => x ?? "") : null,
        v.expected.groups,
      );
    }
  });
