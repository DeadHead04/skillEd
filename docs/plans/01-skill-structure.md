# V1 Package Contract

## Upload

The user uploads one bounded ZIP. SkillEd recursively finds `SKILL.md`. If there
is more than one, the user selects the Skill to test.

The selected root may contain:

```text
SKILL.md
scripts/
references/
assets/
evals/
other supporting files
```

Unknown safe files are preserved. Import never executes package content.

## Import safety

Reject path traversal, escaping symlinks, device files, duplicate normalized
paths, encrypted archives, excessive nesting, excessive file count, oversized
files, and excessive expanded size. Render only safe text and approved images;
other content is download-only.

## Version

Each accepted package creates one immutable `SkillVersion` containing:

- version number and creation time;
- original ZIP;
- selected Skill root;
- package and file checksums;
- parsed `SKILL.md` metadata;
- file manifest;
- validation findings;
- execution readiness: `ready`, `needs_attention`, or `blocked`.

Uploading identical content reuses the version. Changed content creates the next
version. An approved Codex patch also creates the next version. Nothing edits an
existing version.

## Standard worker support

The worker image contains Codex, Skill-Up, Python, Node.js, Git, and the document
and spreadsheet libraries required by the reference JioMart test. Package files
and scripts may run only inside the temporary job directory.

The readiness check reports missing commands or imports. It does not run an
arbitrary setup script or install packages from the internet.

## Task material

The upload screen accepts:

- a task description;
- input files;
- expected output files;
- rules or authority files;
- datasets;
- examples of previous failures.

These files belong to the eval draft, not to the installable Skill. When an eval
version is approved, it includes exact copies/checksums of the task files used.

## Downloads

V1 has three downloads:

1. Original uploaded ZIP.
2. Current or candidate installable Skill ZIP, excluding evals and run outputs.
3. Run report bundle with Skill-Up reports and produced artifacts.

No download contains Codex credentials or worker configuration.
