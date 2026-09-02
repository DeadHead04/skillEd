# Phase 4 — Proposed Upgrades, Comparison, and Export

## Objective

Let the user request a Codex/skill-upper improvement, approve or reject its
changes, verify a candidate, compare it with the active version, and activate
or download it.

## Deliverables

- `upgrade_proposal` conversation bound to an exact base version and source run.
- Structured proposal with top-level behavior summary, file patch, per-change
  rationale, expected impact, risks, compatibility changes, suggested
  regression cases, and rerun plan.
- Review UI with simple **Apply and verify**, **Review details**, and **Reject**
  actions plus file/hunk deep dive.
- Approval that creates a new immutable candidate; rejection and revision that
  never alter the active version.
- Separate approval for proposed Skill changes and eval changes.
- Verification against affected, full regression, and reserved holdout cases.
- Old-versus-new comparison for file changes, fixed/regressed/unchanged cases,
  result dimensions, stability, latency, and tokens.
- Activate, retain, rollback, original/installable/development/diff/evidence
  exports, and checksum manifests.

## Acceptance gate

1. A failed run creates a reviewable proposal without changing the base.
2. Rejecting leaves the active version byte-identical.
3. Approving creates a candidate tied to the exact patch and decision.
4. Eval assertions cannot be silently weakened to make the candidate green.
5. Verification identifies at least one synthetic regression and blocks an
   automatic success claim.
6. Activation is explicit and rollback restores the previous active pointer.
7. Every export excludes credentials and matches its manifest checksums.
