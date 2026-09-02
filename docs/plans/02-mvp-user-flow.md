# V1 UI Flow

## Screen 1 — Skill

The empty state contains **Upload Skill**. The upload form accepts the Skill ZIP,
task description, and task files. After scanning, the page shows:

- selected Skill and files;
- readiness and concrete problems;
- current version;
- task material;
- **Create evals**;
- **Download Skill**.

A later upload creates another version and shows a file diff.

## Screen 2 — Create evals

Selecting **Create evals** starts a Codex App Server conversation with
`skill-upper`. Codex receives the exact Skill version and task material.

The conversation follows three visible steps:

1. **Understanding** — task, inputs, outputs, authorities, allowed changes,
   invariants, dependencies, and likely failures.
2. **Questions** — only missing information that changes test design.
3. **Eval plan** — case groups, fixtures, grading method, count, and evidence
   level.

After the user accepts the plan, Codex generates the draft. SkillEd runs package
policy checks and `skill-up validate`. The user sees each case in plain language
and can disable, edit, regenerate, or inspect YAML. **Approve evals** freezes an
immutable eval version.

## Screen 3 — Run

The run dialog shows the Skill version, eval version, case count, iterations,
and whether to include a without-Skill baseline. It estimates the number of
agent and judge calls. **Start run** queues the work.

```text
queued → preparing → running → judging → completed
                                  ↘ failed
queued|running → cancelling → cancelled
```

The run page receives persisted progress events, so closing the page does not
stop work.

## Screen 4 — Results

The top section shows separate measures for:

- intended task correctness;
- semantic omissions or invented claims;
- source and scope preservation;
- artifact validity;
- stability across iterations;
- time, tokens, and errors;
- with/without-Skill difference when requested.

The case table shows pass/fail/error and a short reason. Opening a case shows its
input, output, produced files, transcript, grader evidence, and unexpected
changes. No single green badge hides a failed scope or validity check.

## Screen 5 — Improve

Selecting **Suggest update** starts a separate Codex + `skill-upper`
conversation using the exact failed run and base Skill version. It produces:

- a short explanation of the failure;
- proposed file changes;
- expected improvement and risks;
- proposed regression-case changes.

The user sees **Approve and test**, **Review diff**, and **Reject**. Skill and
eval changes are approved separately. Approval creates a candidate version and
starts verification; rejection changes nothing.

## Screen 6 — Compare

The comparison runs current and candidate versions against the same eval
version and settings. It shows changed files, fixed cases, regressions, metric
changes, and artifacts. The user can activate the candidate, keep the current
version, request another update, or download either version.

## Conversation rule

Eval authoring and update suggestion use separate persisted Codex threads. Each
test case and each agent judge uses a fresh isolated execution. Test executions
never inherit authoring messages, previous cases, expected answers, or update
discussions.
