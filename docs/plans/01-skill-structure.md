# Skill Package, Versions, and Compatibility

## Accepted input

V1 accepts a bounded ZIP and optional task attachments. The ZIP may contain a
Skill at its root or nested inside a wrapper directory. The scanner recursively
finds `SKILL.md`; when it finds multiple candidates the user selects one and V1
continues with only that primary Skill.

```text
skill-name/
├── SKILL.md
├── scripts/          optional
├── references/       optional
├── assets/           optional
├── authorities/      optional domain material
├── evals/            optional existing Skill-Up suite
└── other files       preserved and classified
```

The original archive is never mutated or executed during import.

## Safe ingestion

Reject traversal paths, escaping symlinks, devices, duplicate normalized paths,
encrypted archives, excessive nesting, excessive file count, oversized files,
and excessive expanded size. Preview only safe text and approved image types;
serve active HTML, scripts, binaries, and unknown formats as downloads.

## Manifest and immutable versions

Each accepted import produces:

```text
SkillVersion
  package_checksum
  skill_md_checksum
  original_artifact
  normalized_runtime_artifact
  parsed_metadata
  files[] { path, checksum, bytes, category, executable }
  references[] { source, target, status }
  dependency_hints[]
  compatibility_findings[]
```

The same package checksum is idempotent. Changed contents create a new version;
they never overwrite the current version. `active_version_id` and optional
`candidate_version_id` are pointers on the stable Skill record.

## Compatibility contract

SkillEd can preserve and re-download any safe bounded archive. Executability is
reported separately:

- `ready`: runnable in the standard worker image.
- `ready_with_warnings`: runnable with known coverage or dependency limits.
- `needs_configuration`: requires a user decision or supported dependency.
- `unsupported`: requires a capability V1 does not provide.
- `blocked`: unsafe package or prohibited behavior.

V1's standard image includes Codex, Skill-Up, Python, Node.js, Git, common
document/spreadsheet libraries, and basic archive/file tools. It may exercise
package files and supported scripts inside the job workspace. It does not run
arbitrary setup scripts or install arbitrary network dependencies. Codex may
propose missing setup, but policy and user approval decide whether it is added
to a future image.

## Runtime views

SkillEd derives checksummed views without changing the original:

- `original`: exact upload.
- `installable`: Skill files with evals, outputs, and secrets excluded.
- `development`: Skill plus approved eval snapshot and fixtures.
- `runtime`: exact files and overlay needed for one run.

The runtime view installs the Skill only in the job-local
`.codex/skills/<normalized-name>` directory.

## Task evidence

Task uploads are stored separately from the Skill version so the same version
can be evaluated against different evidence. Supported V1 evidence categories
are task description, input example, expected output, dataset, authority,
historical failure, and free-form note. Every attachment is checksummed and
included explicitly in an eval-authoring or run snapshot.

## Downloads

V1 exposes:

1. Original upload.
2. Installable Skill ZIP.
3. Full development bundle with an approved eval snapshot.
4. Candidate/version diff.
5. Run-evidence bundle containing reports and produced artifacts.

Every export includes a non-secret manifest and checksums. No export includes
Codex credentials, worker configuration, temporary files, or unrelated task
attachments.
