import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "@skilled/core";
import { completeEvalGeneration } from "../eval/queries.js";

test("generated evals persist only dimensions backed by required assertions", async () => {
  const calls: Array<{ statement: string; values: unknown[] }> = [];
  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.join("?");
    calls.push({ statement, values });
    return Promise.resolve(
      statement.startsWith("SELECT status") ? [{ status: "generating" }] : [],
    );
  }) as unknown as Db;
  tx.json = (value: unknown) => value as never;
  const sql = {
    begin: async (run: (transaction: Db) => Promise<unknown>) => run(tx),
  } as unknown as Db;

  await completeEvalGeneration(sql, {
    evalId: "eval-1",
    pendingCases: [
      {
        definition: {
          id: "CASE-1",
          title: "Required and informational evidence",
          coverageGroup: "boundary",
          provenance: [],
        },
        judge: "agent",
        assertions: {
          Required: {
            id: "required",
            dimension: "correctness",
            required: true,
          },
          Informational: {
            id: "informational",
            dimension: "input_adaptation",
            role: "informational",
            required: false,
          },
        },
      },
    ],
    bundleKey: "evals/eval-1.zip",
    checksum: "checksum",
    generationNotes: [],
    validationOutput: "valid",
    caseCount: 1,
    adapter: "real",
  });

  const insert = calls.find((call) =>
    call.statement.startsWith("INSERT INTO eval_cases"),
  );
  assert.deepEqual(insert?.values[6], ["correctness"]);
});
