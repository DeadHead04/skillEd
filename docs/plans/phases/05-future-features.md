# After V1

The following capabilities begin only after Phases 1–4 pass their acceptance
gates:

- Per-user Codex authentication, concurrency, quotas, billing, and public
  multi-tenancy.
- Projects, multiple Skills, relationships, and environment profiles.
- GitHub import/synchronization, branches, pull requests, and releases.
- Managed deployment to agent platforms.
- Arbitrary dependency installation, live MCP servers, external tools, and
  user-configurable network access with per-tool authorization.
- Production trace ingestion, routing evidence, drift alerts, and reviewed
  production-failure-to-regression workflows.
- Organization roles, audit/compliance exports, retention administration, and
  marketplace features.

V1 schemas should use stable IDs and artifact references so these additions do
not rewrite historical Skill versions, eval snapshots, runs, or proposals.
