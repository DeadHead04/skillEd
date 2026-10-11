import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { decode } from "../../src/contracts/decode.js";
import type { CaseConfig, ModelConfig } from "../../src/contracts/schema.js";
import {
  goPathMatch,
  parseCLIInteger,
  parseVerbosity,
  stringArrayFlag,
  filterCases,
  formatModelRef,
  requestedModelRef,
  evaluateOptionsFromFlags,
} from "../../src/cli/run.js";
import type { ExecutionPlan } from "../../src/runner/index.js";
import {
  eventRunStatus,
  evaluationEventPlan,
} from "../../src/cli/run-events.js";
const corpus = JSON.parse(
  await readFile(
    new URL(
      "../../../tests/integration/phase4-helper-reference.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
test(`Go path.Match helper parity across ${corpus.matches.length} source results`, () => {
  const differences = [];
  for (const vector of corpus.matches) {
    let actual: boolean | string;
    try {
      actual = goPathMatch(vector.pattern, vector.name);
    } catch (e) {
      actual = (e as Error).message;
    }
    if (actual !== vector.matched)
      differences.push({
        ...vector,
        pattern:
          vector.pattern.length > 100
            ? vector.pattern.slice(0, 100) + `...(${vector.pattern.length})`
            : vector.pattern,
        name:
          vector.name.length > 100
            ? vector.name.slice(0, 100) + `...(${vector.name.length})`
            : vector.name,
        actual,
      });
  }
  assert.deepEqual(differences, []);
});
test("Go include/exclude filters preserve ordering, exclusions and duplicate case IDs", () => {
  for (const vector of corpus.filters) {
    const input = vector.input;
    const cases = input.ids.map((id: string) =>
      decode<CaseConfig>("CaseConfig", { id }),
    );
    assert.deepEqual(
      filterCases(cases, input.include, input.exclude).map((c) => c.id),
      vector.expected,
      JSON.stringify(input),
    );
  }
});
test(`Go model-reference helpers match ${corpus.models.length} combinations`, () => {
  for (const vector of corpus.models) {
    const input = vector.input,
      model = decode<ModelConfig>("ModelConfig", {
        provider: input.provider,
        name: input.name,
      });
    assert.equal(formatModelRef(input.provider, input.name), vector.format);
    assert.equal(
      requestedModelRef(model, input.cliProvider, input.cliModel),
      vector.requested,
      JSON.stringify(input),
    );
  }
});
test(`Go evaluation option helpers match ${corpus.options.length} combinations`, () => {
  for (const vector of corpus.options) {
    const input = vector.input,
      command = new Command();
    command.setOptionValue("delete", !input.noDelete);
    command.setOptionValue("outputDir", input.outputDir);
    command.setOptionValue("workspace", input.workspace);
    command.setOptionValue("iteration", input.iteration);
    command.setOptionValue("format", input.formats ?? []);
    if (vector.error)
      assert.throws(() => evaluateOptionsFromFlags(command), {
        message: vector.error,
      });
    else {
      const actual = evaluateOptionsFromFlags(command);
      actual.workspaceDir = actual.workspaceDir?.replace(
        process.cwd(),
        "<CWD>",
      );
      assert.deepEqual(actual, vector.expected);
    }
  }
});
for (const vector of corpus.eventStatuses)
  test(`Go event status helper parity: ${vector.kind}`, () => {
    const cancelled = new DOMException("operation cancelled", "AbortError"),
      deadline = new DOMException("operation deadline", "TimeoutError");
    let error: Error | undefined;
    switch (vector.kind) {
      case "error":
        error = new Error("failure");
        break;
      case "cancelled":
        error = cancelled;
        break;
      case "deadline":
        error = deadline;
        break;
      case "wrapped-cancelled":
        error = new Error("operation", { cause: cancelled });
        break;
      case "wrapped-deadline":
        error = new Error("operation", { cause: deadline });
        break;
      case "joined-cancelled":
        error = new AggregateError([
          new Error("other"),
          new Error("operation", { cause: cancelled }),
        ]);
        break;
    }
    assert.equal(eventRunStatus(undefined, error), vector.expected);
  });

for (const vector of corpus.eventPlans)
  test(`Go event plan helper parity: ${vector.kind}`, () => {
    const plan: ExecutionPlan = {
      skillDir: "",
      skillName: "",
      reportName: "",
      workspaceDir: "",
      caseCount: 1,
      taskPlan: {
        startIteration: 3,
        taskTotal: 1,
        iterations: [
          {
            number: 3,
            tasks: [
              {
                id: "task-1",
                globalIndex: 1,
                globalTotal: 1,
                iteration: 3,
                case: decode<CaseConfig>("CaseConfig", {
                  id: "case",
                  title: "Title",
                }),
                configuration: "with_skill",
              },
            ],
          },
        ],
      },
    };
    const iteration = plan.taskPlan.iterations[0],
      task = iteration.tasks[0];
    switch (vector.kind) {
      case "empty":
        plan.taskPlan.iterations = [];
        plan.taskPlan.taskTotal = 0;
        break;
      case "invalid-iteration":
        iteration.number = 0;
        break;
      case "missing-case":
        task.case = null as unknown as CaseConfig;
        break;
      case "iteration-mismatch":
        task.iteration = 2;
        break;
      case "total-mismatch":
        task.globalTotal = 2;
        break;
      case "invalid-index":
        task.globalIndex = 0;
        break;
      case "invalid-configuration":
        task.configuration = "invalid";
        break;
      case "invalid-index-and-configuration":
        task.globalIndex = 0;
        task.configuration = "invalid";
        break;
      case "expanded-count":
        iteration.tasks = [];
        break;
    }
    if (vector.error)
      assert.throws(() => evaluationEventPlan(plan), { message: vector.error });
    else assert.deepEqual(evaluationEventPlan(plan), vector.expected);
  });

test(`Go base-zero integer flags and decimal verbosity match ${corpus.integers.length} inputs`, () => {
  for (const vector of corpus.integers) {
    if (vector.integerError)
      assert.throws(() => parseCLIInteger(vector.input), vector.input);
    else
      assert.equal(parseCLIInteger(vector.input), vector.integer, vector.input);
    if (vector.verbosityError)
      assert.throws(() => parseVerbosity(vector.input, 4), vector.input);
    else
      assert.equal(
        parseVerbosity(vector.input, 4),
        vector.verbosity,
        vector.input,
      );
  }
});
test(`Go repeated-string flag getter matches ${corpus.arrays.length} inputs`, () => {
  for (const vector of corpus.arrays) {
    const command = new Command();
    command.setOptionValue("values", vector.input);
    assert.deepEqual(
      stringArrayFlag(command, "values"),
      vector.expected,
      JSON.stringify(vector.input),
    );
  }
});
