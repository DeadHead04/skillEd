# Skill Package Structure and Validation

## Canonical package

SkillEd follows the [Agent Skills specification](https://agentskills.io/specification)
and recognizes this portable layout:

```text
skill-name/
├── SKILL.md                     required metadata and instructions
├── scripts/                     optional executable helpers
├── references/                  optional on-demand documentation
├── assets/                      optional templates and static resources
├── evals/                       Skill-Up tests; never installed with the Skill
│   ├── eval.yaml
│   └── cases/
│       ├── primary-workflow.yaml
│       ├── edge-case.yaml
│       └── regression-case.yaml
└── LICENSE                      optional
```

Additional files are permitted, but SkillEd classifies known directories in the
package viewer. The initial evaluator loads only `SKILL.md`; it does not execute
or inject supporting resources.

## `SKILL.md` contract

The file contains YAML frontmatter followed by Markdown instructions:

```yaml
---
name: release-notes-writer
description: Creates structured release notes. Use when summarizing software or product changes.
license: Apache-2.0
compatibility: Produces text responses without external tools.
metadata:
  author: example-team
  version: "1.0"
---

# Workflow

1. Identify user-visible changes.
2. Group them by feature, fix, and operational impact.
3. Produce concise Markdown release notes.
```

Required validation:

- `name` is 1–64 lowercase letters, numbers, and hyphens.
- It has no leading, trailing, or consecutive hyphen.
- It matches the containing directory name.
- `description` is non-empty, at most 1024 characters, and explains both what
  the Skill does and when it should be used.
- Frontmatter is delimited correctly and parses as YAML.
- Markdown content follows the closing delimiter.

Optional fields are `license`, `compatibility`, string-to-string `metadata`, and
experimental `allowed-tools`. A non-empty `allowed-tools` value produces a
response-only compatibility warning because the first release cannot exercise
those tools.

## Progressive disclosure and coverage

Agent platforms normally load Skill metadata for discovery, `SKILL.md` when a
Skill activates, and referenced resources only when needed. The first SkillEd
engine deliberately injects the selected `SKILL.md` instructions for the
with-Skill arm. Therefore:

- It measures instruction effectiveness once the Skill is applied.
- It does not measure agent-native discovery or routing.
- References, scripts, and assets are visible but marked `Not covered`.
- A Skill depending on supporting files may still run, but results must display
  `SKILL.md-only coverage`.

This avoids presenting a response-only pass as proof that the complete package
works in a tool-capable agent.

## Import and discovery

Supported sources:

1. GitHub repository plus optional branch/ref and subdirectory.
2. Uploaded ZIP or folder.

The scanner recursively finds `SKILL.md`. A repository containing multiple
Skills creates multiple catalog entries sharing the same source repository but
with different source paths and stable Skill IDs.

Every import records:

- Source type and source URL or upload identity.
- Repository owner/name and Skill subdirectory where applicable.
- Immutable Git commit or SHA-256 upload checksum.
- Importing actor and timestamp.
- Parsed metadata and package manifest.
- Validation status and findings.

Reimporting the same stable Skill at a new commit creates a version. The system
must not silently replace the files associated with an existing version.

## Package manifest

SkillEd generates a normalized manifest for indexing and integrity checks:

```text
SkillPackageManifest
  source_checksum
  skill_root
  skill_md_checksum
  files[]
    relative_path
    checksum
    byte_size
    category: instructions | reference | script | asset | eval | other
  validation_findings[]
```

The manifest is application metadata, not a required file added to imported
Skills. Paths are normalized to forward slashes and must stay within the Skill
root.

## Validation levels

| Level | Effect | Examples |
| --- | --- | --- |
| Error | Import cannot become runnable | Missing `SKILL.md`, invalid YAML, unsafe path, unreadable archive. |
| Warning | Import succeeds but needs attention | Tool-dependent compatibility, broken relative reference, oversized instruction file. |
| Information | Context only | Scripts or assets exist but are not covered by response-only tests. |

Archive and file safety checks reject absolute paths, `..` traversal, device
files, escaping symlinks, duplicate normalized paths, excessive file count,
excessive uncompressed size, and files above configured limits. The scanner
must never execute package contents.

## Evaluation files

UI-authored tests materialize as standard Skill-Up files:

```text
evals/eval.yaml
evals/cases/<case-id>.yaml
```

SkillEd manages runtime-specific configuration as an ephemeral overlay. Model
gateway URLs, access tokens, container paths, and provider credentials are
never written into the repository.

Published evaluation files are versioned with the Skill source. Draft cases
are stored by SkillEd and frozen into an immutable suite snapshot for each run.
Skill-Up automatically excludes `evals/` when installing the Skill into the
with-Skill workspace, and release packages must preserve that behavior.

## Export rule

A future installation export contains the exact released Skill files, license,
attribution, checksum, and dependency metadata. It excludes `evals/`, test
fixtures, run outputs, local configuration, and secrets by default. Export is
deferred, but the package manifest and version model must not prevent it.
