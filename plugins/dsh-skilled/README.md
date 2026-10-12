# `dsh-skilled`

Experimental DeepSeek Harness (DSH) plugin for testing and iteratively improving
existing Agent Skills with `skilled` and the bundled `skilled-improve` Skill.

The intended workflow starts from a real new input or scenario:

1. Add or refine a regression case for the existing Skill.
2. Run a baseline before changing the Skill.
3. Improve the Skill from observed failures.
4. Rerun the same case and inspect per-case status in `result.json`.
5. Preserve the before/after reports as evidence.

The plugin grounds each improvement in gaps revealed by the supplied scenario
and verifies case status instead of treating process exit alone as proof.

For a worked example of this feedback cycle using `code-stats`,
see the [repository demo](DEMO.md).

## Install from a checkout

Use the [source repository](https://github.com/DeadHead04/skillEd) and follow the [CLI installation guide](../../docs/guide/installation.md) before enabling evaluations.

Prerequisites:

- `dsh` 0.1.5-rc.2 or newer
- `skilled` available on `PATH`
- `pnpm` available on `PATH` for `dsh plugin`

Plugin tests pin the DSH host peer set to `0.1.5-rc.2`. Verify compatibility
separately when using a newer host. Release archive versions follow the
skilled CLI version; this plugin remains experimental regardless of the
archive version.

From the repository root:

```bash
npm ci
npm run build
cd dist/bundled-plugins/dsh-skilled
npm pack
```

This produces a local `dsh-skilled-<version>.tgz`. Install this archive through DSH's supported local plugin flow in an isolated profile. The package is private and is installed from its archive. Packaged releases are listed in [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd/releases); no npm registry publication is required. The build copies the canonical `skills/skilled-improve` workflow and observation schema into this self-contained plugin bundle.

## Capabilities

- Bundles the repository's canonical `skilled-improve` Skill at package time.
- `skilled_validate` validates a workspace-relative evaluation suite.
- `skilled_run` starts an evaluation through DSH's background-job service.
- Each run gets an isolated report directory under
  `evals/.skilled-workspace/`, which the evaluator excludes from the installed
  Skill, so concurrent jobs and before/after evidence cannot overwrite or
  contaminate one another.
- `skilled_summary` reads the per-case statuses in an existing `result.json`.
- `skilled_compare` compares the same cases across preserved baseline and
  post-change reports.
- An opt-in observer reads DSH's durable session events and stores only
  explicitly invoked Skills or Skills successfully loaded through the `skill`
  tool. It never persists inferred attribution.
- After a completed single-Skill turn, the next user turn in the same session,
  within one hour,
  is stored as an unclassified follow-up candidate. This captures natural
  feedback without requiring the user to know an observation ID. Unrelated
  follow-ups can also be captured, so review them before treating them as feedback.
- With the observer enabled, `list_skill_observations`,
  `get_skill_observation`, `collect_skill_feedback`,
  `record_observation_feedback`,
  `link_observation_report`,
  `preview_observation_case`, `review_skill_observation`, and
  `write_observation_case` provide the local review and approval workflow.
- Candidate case writes require an approved observation, never overwrite an
  existing file, remain inside the DSH workspace, and roll back if
  `skilled validate` fails.
- Evaluation arguments are passed as an argv array, not interpolated into a shell.
- Eval and result paths are confined to the DSH workspace, including symlink resolution.

Use the existing `job_output`, `job_list`, and `job_kill` tools to observe or
cancel a run started by `skilled_run`.

## Configuration

The bundle inserts the plugin with safe defaults. Override the row in the
profile's `cordis.patch.yml` when needed:

```yaml
- id: skilled
  name: 'dsh-skilled'
  config:
    skilledBin: skilled
    credentialEnv:
      - OPENAI_API_KEY
      - ANTHROPIC_API_KEY
    observer:
      enabled: true
      # Optional; defaults to $DSH_HOME/plugin-data/skilled-observer.
      dataDir: /local/private/dsh-observations
```

`credentialEnv` is empty by default. DSH deliberately scrubs credential-shaped
environment variables from subprocesses; listing a name explicitly opts that
value into the `skilled` child without logging it. Prefer skilled's credential
file or an already authenticated Agent CLI when possible.

Observation collection is disabled by default. Enabling it is the local
collection consent boundary. The adapter listens to committed `session/event`
records, redacts common credential shapes, stores files with private
permissions, and ignores unattributed turns as well as the control Skills
`skilled-improve`, `codex-skilled`, and `dsh-skilled`. Data is not uploaded.
`collect_skill_feedback` returns 20 observations per page by default for one
Skill, including confirmed feedback and next-turn follow-up candidates. Follow
`next_offset` to review all pages. Ask DSH to
summarize recurring issues with observation IDs before proposing a change.
An external scheduler may send that review request periodically; the plugin
does not schedule reviews or edit Skills by itself.

Review is a separate boundary: collection creates `candidate` observations.
Listing, reading, feedback attachment, and preview do not authorize a case
write. Show the candidate to the user, obtain approval for its exact observation
ID, call `review_skill_observation`, and only then call
`write_observation_case` with a workspace-relative Skill root. The generated
case intentionally has no invented expectations; maintainers must add concrete
assertions before treating it as a release gate.

`skilled run` may execute Agent CLIs, judge scripts, and other code declared by
the selected eval suite. Only run suites you trust. The plugin confines selected
input and report paths to the workspace but does not turn an untrusted eval suite
into trusted code.

If the repository is private, release downloads require an authenticated GitHub session or GitHub CLI. Source builds and local plugin archives remain available without a public release.
