# Account-flow implementation and acceptance — 7 September 2026

Implemented on `codex/account-signup-flow`, based on staging `5ff4b81`. The original installations and prior audit files were preserved. The separate review application runs at <http://127.0.0.1:3400/login> in demo execution mode.

## Delivered behavior

- Login ID/password sign-in, show/hide passwords, same-origin redirect handling and recoverable connection errors.
- Administrator-issued signup links, role binding, user-selected login ID/display name/password, confirmation and completion states.
- Single-use invitations valid for seven days; token hashes stored in PostgreSQL, full links shown once, secrets carried in URL fragments.
- Administrator-assisted password recovery with one-hour single-use reset links. Reissuing a reset link revokes its predecessor. No email delivery is claimed.
- Self-service password change, current-password verification and revocation of prior sessions/reset links.
- Mandatory personal-password selection after administrator-issued temporary passwords.
- Existing bcrypt logins remain valid; new passwords use salted scrypt and preserve long/Unicode input instead of truncating it.
- Atomic login lockout under concurrent attempts; duplicate account IDs, reused/expired/revoked links and inactive accounts rejected.
- Administrator/operator boundaries, removal of caller-supplied identity headers, same-origin account mutations, and private account responses.
- Additive migration 006 and explicit web-only account-token grants. Tokens are not exported as application history.
- Independent sidebar fixtures remove the pre-existing cross-test activation dependency discovered in the staging audit.

## Validation

| Check                                                              | Result                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Repository preflight                                               | Passed in demo mode                                                             |
| Core, worker and web typecheck/lint commands                       | Passed; this repository's lint scripts run TypeScript checks                    |
| Backend suite with PostgreSQL/private services/rebuilt CLI enabled | 63 passed, one platform-specific skip, zero failures (64 total)                 |
| Linux process test for the host-skipped case                       | Passed in the non-root worker image                                             |
| Python XLSX validator                                              | Passed in the worker image                                                      |
| Focused account/password tests                                     | Nine passed, including concurrent claims, lockout, reset races and legacy login |
| Final account and restricted-role integration tests                | Nine passed after the last backend change                                       |
| Full desktop/laptop/mobile browser suite                           | 45 passed, zero failures                                                        |
| Production Docker web/worker builds                                | Passed                                                                          |
| Stack verification                                                 | Passed; database, web and demo worker ready                                     |
| Visual review                                                      | Ten desktop/mobile page captures; no horizontal overflow                        |
| Formatting and whitespace                                          | Checked before handoff                                                          |

The first focused browser attempt failed because new controls made broad text/alert selectors ambiguous. Selectors were scoped to the intended UI elements and the focused journeys then passed. The complete suite subsequently passed, including connection failures, temporary-password enforcement, deactivation/reactivation and the deterministic upload-to-activation journey.

The host's pnpm wrapper was unavailable and its Node version was older than the repository requirement. Package scripts were exercised through their underlying Node commands; the pinned Node 24 Docker build supplies the production build verification. No personal model credentials or real Codex operations were used for account testing.

## UI design and review

The primary decision on each entry screen is sign in, create an invited account, or choose a new password. Administrator invitation issuance stays ahead of the account list; recovery, issued-link history and direct temporary-password creation are secondary. Desktop reuses the existing split authentication layout; mobile puts the form before the explanatory panel. Account changes live in the workbench's account view.

Explicit states include missing invitation, validation errors, pending submission, connection failure, account/link unavailable, temporary-password restriction and completed signup/password change. Native labels, autocomplete hints, password-manager paste, keyboard controls, live error/status messages and 44-pixel password-toggle targets are included. Form secrets are never put in application history.

Screenshot review score: **35/40** (decision clarity 5, evidence hierarchy 4, state truth 5, visual identity 4, restraint 4, typography/spacing 4, accessibility 5, responsive credibility 4). This is a visual/keyboard assessment, not a complete screen-reader certification.

The three remaining minor presentation gaps are repeated password guidance, a long Users page when many test accounts exist, and a lengthy explanatory panel below mobile signup. Remove duplicated confirmation guidance in a later polish pass; preserve the clear primary forms and explicit invitation boundary. The most useful next UI iteration is account-list filtering once the team's actual size requires it. The two issues found during this pass—low-contrast password toggles and the account footer label—were corrected.

Reviewed screenshots: [desktop signup](../screenshots/accounts/desktop-signup.png), [mobile signup](../screenshots/accounts/mobile-signup.png), [desktop user management](../screenshots/accounts/desktop-users.png), [mobile account](../screenshots/accounts/mobile-account.png). Additional login/recovery captures are in the same directory.

## Manual handoff and deployment limits

Follow the [38-step manual checklist](manual-account-flow.md). It includes credentials for the disposable installation, two-window signup/recovery testing, role controls, lockout, mobile/keyboard use and offline recovery.

Migration 006 and role provisioning must run before deploying the updated web image with restricted runtime credentials. Old images without scrypt verification cannot authenticate passwords newly written by this version; retain that verification compatibility in an auth rollback. Invitations/reset links must be reissued after history import. Bootstrap environment variables do not reset an existing administrator.

This remains a shared private team installation with invitation-based access and administrator-assisted recovery. It does not provide unrestricted public customer signup or email delivery. SkillEd account login is separate from Codex login and does not bypass or resolve the outstanding execution-isolation gate.
