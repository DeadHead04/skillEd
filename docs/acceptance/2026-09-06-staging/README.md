# Staging review evidence

Reviewed revision: `5ff4b816e794417d97f97ee63efd50757c32424d` (`origin/staging`), 6 September 2026.

See the [full audit and release sequence](../../audits/2026-09-06-staging-readiness.md) for interpretation, source locations, test results and acceptance criteria. These files are synthetic local test evidence, not authenticated model or hosted Render certification.

| File                                                                 | Evidence                                                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [executor-canary.json](executor-canary.json)                         | Actual pinned CLI sandbox probe in the non-root local worker image; blocked                                                      |
| [approval-reproduction.json](approval-reproduction.json)             | Stale explicit revision rejected, missing revision accepted, decision revision absent                                            |
| [preview-reproduction.json](preview-reproduction.json)               | Large text preview size/truncation mismatch, inactive label and API authorization probe                                          |
| [ui-observations.json](ui-observations.json)                         | Terminal-state views, missing recovery/download controls and hidden repeated-trial dimension failure                             |
| [cloud-before-cache-config.json](cloud-before-cache-config.json)     | Separate artifact-service upload succeeds, web preview/download fail with unwritable local cache                                 |
| [cloud-after-cache-config.json](cloud-after-cache-config.json)       | Same remote package previews/downloads successfully after temporary web cache configuration; duplicate intake remains a conflict |
| [render-blueprint-validation.json](render-blueprint-validation.json) | Render CLI accepted the schema; this is not a runtime deployment test                                                            |
| [package-desktop.png](package-desktop.png)                           | Same uploaded version described as active and inactive                                                                           |
| [completed-desktop.png](completed-desktop.png)                       | Two PARTIAL trials reduced to one, hiding a source-preservation failure                                                          |
| [completed-mobile.png](completed-mobile.png)                         | Narrow-screen evidence inspection                                                                                                |
| [error-desktop.png](error-desktop.png)                               | ERROR-only fixture given a green “No Skill failures” summary                                                                     |

No personal credentials, environment stores, private signing keys, migration environment files or browser sessions are included. Application IDs and task contents refer only to disposable synthetic review fixtures. No application implementation changes are included in this audit delivery.
