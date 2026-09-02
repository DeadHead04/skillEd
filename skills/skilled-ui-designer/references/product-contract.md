# SkillEd Product Contract

## V1 outcome

One trusted user operates the entire product from the browser:

```text
Upload Skill ZIP and task files
→ Codex + skill-upper understands the task and drafts evals
→ user approves an eval version
→ Skill-Up runs Codex in the cloud
→ user understands results and failures
→ Codex + skill-upper proposes a change
→ user approves or rejects Skill and eval changes
→ candidate is verified against the current version
→ user activates or downloads the chosen Skill
```

## Objects visible to the user

- Skill
- Skill version: current, candidate, or historical
- Task material
- Eval draft and approved eval version
- Eval case
- Run and case result
- Update proposal
- Downloadable Skill or run report

Do not introduce projects, teams, repositories, deployments, marketplaces,
production traces, or billing into v1 UI.

## Trust model

The cloud worker uses one already-authenticated Codex account and runs one job
at a time. The user does not configure credentials, providers, worker images,
network policy, or shell commands in the UI.

## Result truth

The result UI must preserve independent evidence:

- intended task correctness;
- semantic omissions and invented claims;
- source/invariant preservation;
- unrelated drift;
- output artifact validity;
- stability across repeated trials;
- duration, tokens, and errors;
- without-Skill difference when the user requested a baseline.

`PASS` is not sufficient evidence by itself. Every status must link to its
assertion and supporting artifact or explanation.

## Approval truth

- Eval generation produces a draft, not an approved test suite.
- Starting a run is an explicit action.
- Update generation produces a proposal, not a changed Skill.
- Skill-file and eval-file changes receive separate decisions.
- Approval creates a candidate version.
- Candidate verification does not activate it.
- Activation is explicit and reversible by selecting an older immutable
  version.

## Eval sophistication

The interface must communicate how much evidence was supplied:

- `Provisional`: Skill instructions only.
- `Behavioral`: task description and examples.
- `Grounded`: expected outputs or authority rules.
- `Strong`: dataset coverage and/or past failures in addition to grounding.

Show what is missing and the practical consequence. Do not display a confidence
percentage that implies statistical certainty.

## Source documents

The maintained product plan is under `/docs/plans`. Treat it as authoritative
when it conflicts with exploratory assets or generated mockups.
