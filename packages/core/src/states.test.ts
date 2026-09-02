import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertTransition } from "./states";
describe("state machines", () => {
  it("allows defined transitions", () =>
    assert.doesNotThrow(() => assertTransition("eval", "ready", "approved")));
  it("returns a conflict-like error for invalid transitions", () =>
    assert.throws(
      () => assertTransition("run", "completed", "running"),
      /Invalid/,
    ));
});
