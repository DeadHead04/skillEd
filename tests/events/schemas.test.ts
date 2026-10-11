import { test } from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  JSONLSink,
  Publisher,
  Lifecycle,
  type Event,
} from "../../src/events/index.js";
const schemaRoot = new URL("../../../assets/schemas/", import.meta.url);
async function validator() {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  (formats as unknown as (a: Ajv2020) => void)(ajv);
  const folder = new URL("evalevent/v1/", schemaRoot);
  for (const name of await readdir(folder))
    if (name.endsWith(".schema.json"))
      ajv.addSchema(JSON.parse(await readFile(new URL(name, folder), "utf8")));
  return ajv;
}
test("production lifecycle output validates against every ported JSON schema", async () => {
  const ajv = await validator(),
    dir = await mkdtemp(join(tmpdir(), "skilled-schema-"));
  try {
    const path = join(dir, "events.jsonl"),
      publisher = new Publisher(await JSONLSink.open(path));
    const lifecycle = new Lifecycle(publisher, {
      iterations: [
        {
          number: 1,
          tasks: [
            {
              id: "task",
              caseID: "case",
              configuration: "with_skill",
              index: 1,
              iteration: 1,
              title: "Schema",
            },
          ],
        },
      ],
    });
    await lifecycle.start("custom", "schema");
    await lifecycle.setPhase("executing");
    await lifecycle.iterationStarted(1);
    await lifecycle.caseStarted("task");
    await lifecycle.caseCompleted("task", "PASS", 1);
    await lifecycle.iterationCompleted(1);
    await lifecycle.finish("COMPLETED");
    await publisher.close();
    const events: Event[] = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(new Set(events.map((e) => e.event)).size, 7);
    for (const event of events) {
      const validate = ajv.getSchema(
        `urn:skilled:evalevent:v1:${event.event}-v1`,
      )!;
      assert.equal(validate(event), true, JSON.stringify(validate.errors));
    }
    const envelope = ajv.getSchema("urn:skilled:evalevent:v1:envelope")!;
    assert.equal(envelope({ ...events[0], future_field: true }), true);
    assert.equal(envelope({ ...events[0], last_event: false }), false);
    assert.equal(envelope({ ...events[0], sequence_number: 2 ** 53 }), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("actual Codex and DSH observation documents validate against unchanged schema structure", async () => {
  const ajv = new Ajv2020({ strict: false });
  (formats as unknown as (a: Ajv2020) => void)(ajv);
  const folder = new URL("skill-observation/v1alpha1/", schemaRoot);
  const validate = ajv.compile(
    JSON.parse(
      await readFile(new URL("observation.schema.json", folder), "utf8"),
    ),
  );
  for (const host of ["codex", "dsh"]) {
    const doc = JSON.parse(
      await readFile(
        new URL(`fixtures/${host}-observation.json`, folder),
        "utf8",
      ),
    );
    assert.equal(validate(doc), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...doc, unknown: true }), false);
  }
});
