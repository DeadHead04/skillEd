# Multi-Skill portfolio and local authentication

## Product decision

Named local users can retain multiple Skill packages. Selecting a Skill
changes the Package, Evals, Runs, and Improve workflow as one scoped context.
No global “current run” or “current eval” may leak from another Skill.

The sidebar shows each package’s active version and the latest run as an honest
case count (`6/10`), not a combined quality percentage. Full result pages keep
correctness, semantic, source, scope, artifact, stability, token, duration, and
error evidence separate.

## Authentication boundary

- `SKILLED_ADMIN_LOGIN_ID` and `SKILLED_ADMIN_PASSWORD` bootstrap the first
  administrator only when the users table is empty.
- Passwords are stored as bcrypt hashes through PostgreSQL `pgcrypto`.
- `SKILLED_SESSION_SECRET` signs a 24-hour HTTP-only, same-site cookie carrying
  user ID, role, expiry, and revocation version.
- All pages and APIs except login and health require the session.
- Administrators manage named administrator and operator accounts. Operators
  use the shared Skill workspace but cannot manage users.
- Deactivation, password reset, and role changes increment the session version,
  invalidating existing sessions on their next request.
- Five failed attempts lock a login ID for 15 minutes. Account mutations are
  recorded in `user_audit_events`.
- Self-deactivation is blocked, and at least one active administrator remains.
- Worker Codex credentials are never exposed to the web container or browser.
- This is trusted local access control, not public identity, SSO, tenant
  isolation, or per-user Codex OAuth.

## Package-scoped lookup

The selected Skill ID travels as the `skill` query parameter. Server reads use
it when resolving `current` eval, run, and proposal records. Direct immutable
resource IDs remain valid, while cross-workflow links preserve the Skill ID.

Uploads resolve a Skill by its frontmatter name. A new name creates a package;
the same name creates the next immutable version. Explicit uploads become that
package’s active version. Eval version numbers are allocated within the Skill,
not globally.

## Interface hierarchy

Desktop uses a persistent package list above the Package/Evals/Runs/Improve
workflow. Mobile turns the package list into a horizontally scrollable selector
before the workflow tabs. The Package screen shows readiness, downloads, version
upload, and recent evidence runs. Each run row includes exact Skill/eval versions
and PASS/PARTIAL/FAIL/ERROR counts.

## Acceptance checks

- An unauthenticated page redirects to login and an unauthenticated API returns
  `401 AUTH_REQUIRED`.
- A valid named login issues an HTTP-only session and logout clears it.
- An operator receives `403 ADMIN_REQUIRED` from user-management APIs.
- Deactivating an operator invalidates their existing session immediately.
- The last active administrator cannot be deactivated or demoted.
- Two different Skill ZIP names can coexist and are separately selectable.
- Selecting either package keeps its active version, latest eval, latest run,
  and proposal isolated.
- Uploading changed bytes under the same Skill name creates its next version.
- The latest-run count in the sidebar matches the failure-first result page.
- Login and every workflow screen have no horizontal page overflow at desktop,
  laptop, or mobile widths.
