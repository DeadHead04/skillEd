# Phase 1 — Skill Import and Catalog

## Objective

Deliver a workspace-scoped catalog where users can import, validate, search,
list, and inspect immutable Skills without executing their contents.

## Deliverables

### Foundation

- Scaffold the web application, shared domain package, database migrations,
  authentication, and workspace roles.
- Configure a GitHub integration suitable for public and authorized private
  repositories.
- Define package and artifact-store interfaces with local development
  implementations. For local development keep the aritficat store in the file system itself.
- Seed a development workspace and sample Skills; do not depend on production
  credentials for automated tests.

### Import pipeline

- GitHub import accepts repository or a ref to it and resolves the
  ref to a commit, then downloads a bounded archive.
- Upload import accepts ZIP/folder content through a staged object with file,
  count, and uncompressed-size limits.
- Extract into a temporary directory with traversal, symlink, device-file, and
  duplicate-path protections.
- Recursively discover `SKILL.md`, parse packages, generate manifests, validate,
  and store immutable snapshots.
- Create or reuse stable Skill identity and deduplicate versions by source
  commit.
- Record an audit event and remove temporary extraction data.

### Catalog UI

- Catalog table/grid, search, filters, sort, pagination, loading, empty, and
  error states.
- Import flow with source selection, progress, detected-Skill selection, and
  validation summary.
- Skill detail with Overview and Files tabs.
- Read-only safe file preview with syntax-aware Markdown/code rendering and
  binary/oversize fallback.
- Test, Runs, and Statistics tabs appear as empty states linking to later
  phases.

## Policy

- For MVP a user is allowed to import.
- Invalid Skills can be cataloged for repair but cannot run.
- (Deferred) Search never exposes records outside the authorized workspace.
- Import does not execute scripts, install dependencies, resolve external
  Markdown URLs, or render active HTML/JavaScript.
- GitHub access tokens remain in the connection layer and never enter snapshots
  or audit summaries.

## Parallel work

After shared types and migrations are reviewed:

- Track A: archive/GitHub acquisition and package scanner.
- Track B: catalog queries and search indexes.
- Track C: import, catalog, and detail UI using mocked API contracts.
- Track D: artifact-store and authorization integration.

Integration begins when the scanner produces the agreed `SkillPackageManifest`
and catalog APIs return stable fixtures.

## Acceptance gate

1. Import one valid Skill from GitHub and find it in search.
2. Import a repository containing multiple Skills and select a subset.
3. Reimport the same commit without duplicating versions.
4. Import a new commit as a distinct immutable version.
5. Display validation errors for malformed frontmatter.
6. Reject traversal, escaping symlink, zip bomb, and oversized-file fixtures.
7. Prevent a viewer from importing or reading another workspace’s data.
8. Preview allowed text/images without executing HTML, scripts, or binaries.
9. Record provenance, checksum, actor, and timestamp for every successful
   import.

## Out of scope

Skill editing, tests, execution, GitHub publication, relationships, packaging,
and production telemetry.
