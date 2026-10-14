# Compare results and understand scores

## Compare a baseline with a candidate

Preserve each run in a separate output directory. With your engine configured:

```sh
skilled run evals/eval.yaml --output-dir baseline --format json
# Make the intended Skill change, keeping the evaluation suite fixed.
skilled run evals/eval.yaml --output-dir candidate --format json
skilled compare baseline/iteration-1/report.json candidate/iteration-1/report.json
skilled compare baseline/iteration-1/report.json candidate/iteration-1/report.json --format json --fail-on-regression
```

`compare` reads existing `report.json` or compatible `result.json` files without
calling an agent. It matches the pair `case_id` and `configuration`, preserving
the distinction between `with_skill` and `without_skill`. Duplicate case keys,
duplicate JSON properties and invalid verdicts or grading counts are rejected.
Input files are limited to 32 MiB each; MCP has a smaller 4 MiB file limit.

A regression means a previously passing matched case now has another status,
or a comparable assertion score decreased. With `--fail-on-regression`, the CLI
returns exit code 1 when regressions exist. Invalid input also returns 1 with an
error message; JSON comparison output distinguishes a completed comparison.

Added and removed cases are reported separately. They do not trigger the
regression flag, so review coverage changes before accepting a candidate.
An empty or disjoint suite cannot establish an improvement.

Scores are compared only for scored PASS/FAIL verdicts with matching nonempty
prompts, assertion text, judge identities and report identity. Skipped or empty
grading is unscored. Reports do not contain complete input, fixture and judge
configuration fingerprints, so comparisons always disclose this limitation.
Engine/model changes are reported as provenance warnings; they can be the
intended variable in a comparison. A status transition is evidence of a changed
result, not proof that a Skill edit alone caused it.

`run --baseline` is a different experiment: it runs with and without the Skill
in one evaluation using the verified Docker isolation boundary. Native `none`
and OpenSandbox benchmarks are blocked; ordinary evaluations remain supported.
See [benchmark setup](./writing-evals.md#benchmark-mode). `compare` compares any two completed report files, including
an earlier version and a revised version. It does not orchestrate those runs.

## Case pass rates and assertion scores

From version 0.2.0, prerequisite `expect` checks and judge scoring are separate:

| Outcome | Case verdict | Judge grading | Assertion benchmark credit |
| --- | --- | --- | --- |
| An `expect` check fails | FAIL | SKIP, reason `expect_gate_failed` | 0 |
| Gates pass, 1 of 4 judge assertions passes | FAIL | FAIL, 1/4 | 0.25 |
| Gates pass, all 4 judge assertions pass | PASS | PASS, 4/4 | 1 |

Gate details remain in the report's `gates` field. Unexecuted judges do not
receive fabricated failed assertions. Passing gates do not add assertions to
the judge rubric. This prevents failed prerequisites from looking better than
partially successful judged results, including when a script produces a dynamic
number of assertions.

The overall case pass rate counts cases with verdict PASS. The
Anthropic-compatible assertion benchmark uses grading pass rates and assigns
zero credit to unexecuted judging after a gate failure. Independent multi-judge
aggregation continues to use member verdicts, without weighting a judge by its
number of assertions.

**Refresh baselines made before 0.2.0** if they combine gates with a single judge.
Their assertion percentages use different scoring semantics. Keep old reports
for history, but do not claim an improvement from mixing those score definitions.

## Validate source and installed files

```sh
skilled validate --skill ./my-skill
skilled validate ./my-skill/evals/eval.yaml
```

The first command requires nonempty string `name` and `description` fields in
`SKILL.md` YAML frontmatter. It checks direct local Markdown links and literal
`references/`, `scripts/` and `assets/` paths in inline code. Remote URLs, anchors,
fenced examples and template/glob paths are excluded. Referenced paths must stay
within the Skill directory, including through symlinks. It does not infer
dependencies from prose, source code or referenced documents.

During installation, skilled checks that file selection keeps `SKILL.md` and
its declared references, hashes selected source files, then reads installed
files back through the runtime and verifies their SHA-256 digests. This adds a
readback transfer per file. Metadata-free legacy installations and generic
workspace installs remain supported; use explicit source validation to enforce
metadata requirements. File integrity does not prove that an agent selected or
applied a Skill correctly.
