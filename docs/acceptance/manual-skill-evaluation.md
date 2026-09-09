# Manually test Skill evaluation from upload to activation

Use **http://127.0.0.1:3400/login**, with login ID `admin` and password `deterministic-test-password-only`. These credentials belong to the isolated local test installation. It is already running; no terminal setup is needed for this walkthrough.

This installation exercises the real browser, API, database, uploads and approval workflow. Its worker produces **Demo evidence**: task understanding, generated evaluations, results and proposed improvements are deterministic fixtures. Completing this walkthrough does not establish that a model read your files, that the Skill is good, or that real execution is ready for Render.

## 1. Prepare a concrete task

Use the files in [examples/manual-skill-evaluation](../../examples/manual-skill-evaluation). The task is product-copy quality control: approve supported copy, reject unsupported claims and missing warnings, and detect protected-field changes. Everything in these files is synthetic.

| File                                                                                  | Where to use it                                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [manual-product-qc.zip](../../examples/manual-skill-evaluation/manual-product-qc.zip) | **Skill ZIP**. Contains only `SKILL.md`.                            |
| [task-description.txt](../../examples/manual-skill-evaluation/task-description.txt)   | Paste the text into **What should this Skill reliably accomplish?** |
| [product-cards.json](../../examples/manual-skill-evaluation/product-cards.json)       | Task material: **Input dataset**                                    |
| [authority.md](../../examples/manual-skill-evaluation/authority.md)                   | Task material: **Authoritative rules**                              |
| [past-failures.md](../../examples/manual-skill-evaluation/past-failures.md)           | Task material: **Past failures**                                    |
| [expected-review.json](../../examples/manual-skill-evaluation/expected-review.json)   | Task material: **Expected outputs**                                 |

The input has four cards: supported copy, an unsupported clinical claim, a missing peanut warning and a changed SKU. A correct real review should respectively return PASS, FAIL, FAIL and FAIL, with specific evidence. These are the **task's QC decisions**: the evaluation should give the Skill PASS for correctly rejecting a bad card. Do not confuse rejecting bad copy with failing the Skill evaluation.

Keep the expected decisions outside the Skill ZIP and classify them as expected outputs. Hidden judging truth must not be placed in the tested Skill package.

## 2. Upload and inspect

1. Sign in, then choose **Add Skill package**. A direct starting link is <http://127.0.0.1:3400/skill?new=1>.
2. Select `manual-product-qc.zip` in **Skill ZIP**.
3. Paste `task-description.txt` into the task description field.
4. Select the four material files listed above. Change each file's classification to match the table; do not leave the expected decisions classified as inputs.
5. Click **Upload and inspect**. Expect an evaluation draft for `manual-product-qc`.
6. Inspect the package and task materials. Confirm the Skill name, instructions and file contents are the intended ones. Uploading must not activate this version.

If you already uploaded the exact package, select it in the sidebar and use **Evals → New evaluation**. A duplicate-package rejection is not a reason to delete history. Check the new draft's materials and add the needed files there; do not assume they were copied.

## 3. Understand the task and approve coverage

7. Click **Start understanding**. Wait for the task understanding and coverage plan.
8. Check inputs, outputs, authorities, protected fields and failure modes. The product task should cover unsupported claims, omitted warnings, invented citations and changed identifiers. In demo mode, this is a prepared product-QC plan rather than model reasoning over each uploaded card.
9. If the page asks blocking questions, answer them before proceeding. Where draft revisions are available, review the updated plan after submitting a change.
10. Click **Generate evals** after the plan is acceptable. This approves the plan and starts generation; it does not approve the generated tests yet.
11. Open individual cases. Inspect their prompts, required dimensions, assertion mappings, source references and available validator/fixture details. Do not approve a real suite unless the actual inputs and required output checks match the task.
12. Review enabled cases before approval. The limit is **50**. The standard unedited demo contains ten prepared cases; these are not a one-to-one conversion of the four sample cards.
13. Click **Approve evals**. Expect **Suite approved and frozen**. Editing an approved suite requires **Clone as new draft** and a new approval.

## 4. Run the approved evaluation

14. Click **Configure run**.
15. Keep the desired cases selected, choose **2** for **Repeated trials**, and check **Include a baseline without the Skill**.
16. Check the displayed execution count. It is selected cases × trials × configurations. Ten cases × two trials × with/without Skill means **40 task executions**, plus judges. In demo mode these are synthetic samples; real execution would consume model resources.
17. Click **Launch evaluation** once. Copy/bookmark the resulting run URL.
18. Refresh while the run is progressing. It should recover the same job/run rather than create a second run. Wait for a terminal result.
19. Confirm **Demo evidence** is visible on this installation. A model name in run metadata does not establish that a model was called.

## 5. Inspect the evidence

20. Open a failing or partial case. Inspect its prompt, response and assertion evidence. A task assertion failure and a judge/execution error mean different things:
    - **PASS:** all required assertions passed.
    - **PARTIAL:** correctness passed but another required dimension failed.
    - **FAIL:** the Skill failed a required task check.
    - **ERROR:** execution or grading did not provide trustworthy evidence.
21. Compare the Skill samples with the separate **Without the Skill** section. Baseline benefit and consistency across repeated trials answer different questions.
22. Click **Download raw report**. Preserve this report with the run URL. Check case IDs, configurations and iterations against the count you launched; the summary alone is insufficient for repeated-trial review.
23. Click **Start another run** to confirm reruns are available. For an additional run, use one trial and no baseline and confirm the smaller count before launching.

Current staging has documented gaps in repeated-trial summaries, interrupted/failed-run evidence views and some previews. A green headline must not replace assertion-level/raw-report inspection. See the [staging audit](../audits/2026-09-06-staging-readiness.md), particularly R06–R09. Missing evidence is a defect/blocker to record, not a manual-test pass. Demo outcomes also do not prove the four uploaded cards were actually executed or judged.

## 6. Review and verify an improvement

24. Return to the completed run and click **Suggest update**.
25. Inspect each proposed file change and its explanation. Compare the before/after Skill instructions with the failures being addressed. In this installation, the proposal is a demo fixture.
26. Keep **Skill changes** selected. Leave **Eval changes** unselected for this first walkthrough so the candidate must face the same tests. Click **Approve Skill only**.
27. Expect **Candidate created; active bytes unchanged**. Download the candidate package if you want to inspect it locally.
28. Click **Verify candidate**. Verification compares the base/current version and candidate using the same approved evaluation and three trials for each. With ten cases this is 60 task samples across the two versions, plus judges; it is separate from the earlier optional no-Skill baseline.
29. Inspect the comparison when verification completes. Required fixes must pass, candidate results must be stable, and new required-assertion failures or missing/error samples must block activation. Record any discrepancy rather than forcing a success state.
30. Only when the proposal is verified, click **Activate candidate**. Expect **Candidate is now the active Skill**. Verification alone must not activate it.
31. Open **Package** and version history. Confirm the new active version and retained original version. Download the candidate/active package, then start a new run if you want to inspect the active version's behavior.

The demo allows testing this explicit activation flow inside the demo installation. Its results cannot certify a real candidate in real mode.

## 7. Test recovery and boundaries

32. On a separate draft, exercise material preview, reclassification and removal before approval. Inspect the final draft again before approving.
33. Try editing an already approved suite. Expect the clone path/conflict, with the approved content preserved.
34. On a separate run, refresh and try cancellation while it is queued/running. A fast demo may finish before cancellation is possible; record that as not exercised. Cancellation/restart with partial real evidence needs a longer controlled acceptance task.
35. Try a request with the browser temporarily offline, then restore connectivity. Record whether the app preserves the current workflow and offers a usable retry. Do not assume every page's error recovery is complete; the staging audit lists known gaps.
36. Open **Diagnostics** as administrator. Check worker heartbeat, queue, storage and execution mode. **Demo** is the expected mode here. Browser/database health does not certify Codex readiness.

For a useful manual result, record the Skill name, eval URL, run URL, proposal URL, whether evidence was demo/real, and the exact first step that differs from this guide. Keep exported reports; no passwords or credential files belong in test evidence.

## Real Skill testing and full executor setup

Real end-to-end evaluation is still blocked. The previously measured local sandbox check failed with `bwrap: No permissions to create a new namespace`; the canary also leaves required acceptance cases pending. The screenshot's error is the application's execution-readiness gate. Repeatedly clicking **Retry generation** or signing into SkillEd does not repair it.

Before repeating the workflow with real Skill-Up/Codex evidence:

1. Complete the isolation/limits harness and make its credential-free checks pass on the intended executor host through the actual production permission paths.
2. Authenticate Codex directly on that executor through its official flow. Keep login state on its intended persistent disk and out of uploads/images/migrations.
3. Finish all required initial/resume/App Server/judge/login-persistence/recovery checks. Publish measured passing evidence for the exact image revision, with valid freshness and a real renewal procedure.
4. Wire that report and revision into the executor and confirm **execution ready** in diagnostics. Keep the guard enforced while any prerequisite is missing.
5. Start with one approved case, one trial, no baseline. Inspect the actual staged input, produced output, raw report, assertion evidence and execution provenance. Ensure missing output, protected-field changes and validator exceptions are distinguishable.
6. Then run the full suite, repeated trials, baseline, candidate verification and explicit activation above. Include bounded cancellation/restart and partial-evidence checks before calling the setup ready.

The [execution-readiness incident and repair sequence](../operations/2026-09-07-generation-readiness-incident.md) records the concrete missing pieces. It does not claim they have been fixed. The screenshot's exact URL is still needed to connect those findings to that particular instance.

The local walkthrough uses web + worker + PostgreSQL with local artifact volumes. Render uses separate web, controller, executor, artifact and PostgreSQL services. Passing the local demo therefore does not certify the split deployment, persistent disks, migration or hosted sandbox. Use the [Render operations runbook](../operations/private-render-pilot.md) and [staging audit](../audits/2026-09-06-staging-readiness.md) for those remaining gates.

## If the local test server is stopped

Run from the repository directory, preserving volumes:

```sh
./scripts/preflight.sh --demo
COMPOSE_DISABLE_ENV_FILE=true docker compose -p skilled-account-review -f compose.test.yaml -f compose.accounts.yaml up -d --build
COMPOSE_DISABLE_ENV_FILE=true COMPOSE_FILE=compose.test.yaml:compose.accounts.yaml COMPOSE_PROJECT_NAME=skilled-account-review SKILLED_BASE_URL=http://127.0.0.1:3400 ./scripts/verify-stack.sh --demo
```

Use port 3400 for this guide. Keep the original installation and its history intact. Do not remove volumes or change the original worker's execution mode to make the walkthrough pass.
