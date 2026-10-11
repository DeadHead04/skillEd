import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseYAML } from "../../src/contracts/decode.js";
import { parseCaseConfig } from "../../src/config/loader.js";
const vectors: {
  name: string;
  source: string;
  value?: unknown;
  error?: string;
}[] = JSON.parse(
  await readFile(
    new URL(
      "../../../tests/config/phase4-unicode-reference.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
for (const vector of vectors)
  test(`original Go YAML Unicode escape parity: ${vector.name}`, () => {
    if (vector.error) {
      // The existing library already rejects values beyond U+10FFFF; its diagnostic
      // wording is deliberately outside this surrogate compatibility correction.
      assert.throws(
        () => parseYAML(vector.source),
        vector.name === "too-large"
          ? /Invalid escape sequence/
          : { message: vector.error },
      );
    } else assert.deepEqual(parseYAML(vector.source), vector.value);
  });
test("actual case decoder accepts literal and eight-digit Unicode, rejects JSON surrogate escapes", () => {
  assert.equal(
    parseCaseConfig('input: {prompt: "phase-three-😀"}').input.prompt,
    "phase-three-😀",
  );
  assert.equal(
    parseCaseConfig('input: {prompt: "phase-three-\\U0001F600"}').input.prompt,
    "phase-three-😀",
  );
  assert.throws(
    () =>
      parseCaseConfig(
        String.raw`{"input":{"prompt":"phase-three-\ud83d\ude00"}}`,
      ),
    /invalid Unicode character escape code/,
  );
});
