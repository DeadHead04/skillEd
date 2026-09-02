# Phase 1 — V1 Foundation and Package Intake

## Objective

Establish the new application shell and safely convert a ZIP plus task evidence
into a versioned, inspectable Skill workspace.

## Deliverables

- Next.js UI/API, PostgreSQL, durable worker queue, local/S3 artifact interface,
  development authentication, and a single trusted-user workspace.
- Safe bounded ZIP staging, extraction, `SKILL.md` discovery, primary candidate
  selection, metadata parsing, file/reference manifest, checksums, validation,
  compatibility classification, and immutable `SkillVersion` persistence.
- Optional task-evidence upload with explicit kind and immutable snapshots.
- Package page with file preview, findings, compatibility, version timeline,
  upload-new-version, and original/installable download.
- Clean interfaces for artifacts, jobs, packages, and checksums; no dependency
  on `skill-up/internal/*`.

## Acceptance gate

1. Upload root and nested valid Skill ZIPs and create v1.
2. Select one primary Skill when an archive contains multiple candidates.
3. Deduplicate an identical checksum and create v2 for changed contents.
4. Reject traversal, symlink, device, duplicate-path, encrypted, oversized, and
   expansion-bomb fixtures without executing content.
5. Preview safe files and never render active package HTML or scripts.
6. Upload each supported task-evidence kind and freeze a selected snapshot.
7. Download byte-identical original and checksummed installable exports.
8. Complete all operations from the UI.
