---
name: skilled-ui-designer
description: Design, implement, or critique high-fidelity SkillEd web UI for the upload-to-eval-to-upgrade workflow. Use for SkillEd screen architecture, interaction design, visual direction, responsive implementation, screenshot review, or UI polish; do not use for evaluator or cloud-runner backend work that has no user-interface impact.
---

# SkillEd UI Designer

Create a precise, confident interface for a technical product whose central job
is turning opaque agent behavior into evidence a user can understand and act on.
The UI must feel like a professional evaluation instrument, not a generic SaaS
dashboard or an AI chat wrapper.

## Start with the product truth

For every SkillEd UI task, read
[`references/product-contract.md`](references/product-contract.md). Do not add
screens, roles, integrations, or entities that are not in the current v1 flow.

Then select only the reference needed for the request:

- Visual exploration or art direction: read
  [`references/design-language.md`](references/design-language.md).
- Screen/flow design or implementation: read
  [`references/screen-blueprints.md`](references/screen-blueprints.md).
- Screenshot critique or final polish: read
  [`references/critic-rubric.md`](references/critic-rubric.md).

## Working modes

### Explore

Use when the direction is not locked. Generate three genuinely different
directions before refining one. Vary structure, density, typography, material,
and interaction rhythm—not just colors. A random seed string may be used as
private inspiration to break default model patterns, but never expose it in the
product.

For each direction provide a one-sentence emotional intent, its distinctive
composition and interaction idea, what it makes clearer for SkillEd, and its
main usability risk.

Use ImageGen when available to create a direction board or moodboard. Treat
generated images as a visual-quality baseline, not pixel specifications or
production assets. Do not trust generated small text; product copy remains
defined in code and screen specifications.

### Define

Turn the selected direction into a coherent system before designing every
screen. Specify typography roles, spacing rhythm, surfaces, status colors,
border/radius logic, motion, and the recurring layout grammar. Explain how the
identity supports evidence review and approvals rather than decorating them.

### Implement

Inspect the existing application, local agent instructions, component patterns,
and framework documentation before editing. Reuse working primitives, but do
not preserve an established pattern when it conflicts with the approved design
direction or product truth.

Implement the smallest complete vertical slice. It must include real content
hierarchy and the relevant empty, loading, blocked, error, active, and completed
states. Use semantic HTML, keyboard-operable controls, visible focus, readable
contrast, and responsive behavior from the first slice.

Use generated imagery only where it materially improves comprehension or
identity. Never replace functional UI, icons, charts, diffs, or data with a
raster mockup. Prefer CSS and code-native components for the actual product.

### Critique

Review screenshots, not implementation effort. When an independent critic
context is available and authorized, give it only the screenshot, target
direction, screen purpose, and rubric—never the code or prior rationale. Run at
most two focused improvement rounds unless the user requests more. Stop early
when the remaining issues are minor or the second round is not converging.

## Non-negotiable interface behavior

- One obvious primary action per state.
- Show the exact Skill version and eval version wherever a run or proposal is
  created or reviewed.
- Separate task correctness, semantic quality, scope preservation, artifact
  validity, stability, time, and tokens. Never hide them inside one score.
- A failed dimension remains visible even when the overall target was repaired.
- Generated evals are drafts until the user approves them.
- Proposed Skill and eval changes are approved separately.
- An approved update creates a candidate; activation is a separate explicit
  decision.
- Conversation is a tool inside a structured workflow. Important questions,
  decisions, cases, diffs, and run state must also exist as durable UI objects.
- Progressive disclosure: concise decision summary first, evidence and raw YAML
  or transcripts one level deeper.
- Status cannot rely on color alone. Pair color with text and shape/icon.

## Avoid default AI UI patterns

Do not default to purple gradients, glassmorphism, glowing blobs, a grid of
indistinguishable cards, oversized marketing headlines, excessive pills,
gratuitous charts, or chat taking the entire page. Avoid decorative robot or
sparkle imagery. Remove labels, containers, and helper copy that do not change
the user's decision.

## Required design output

For a new screen or flow, produce:

1. User decision and information hierarchy.
2. Desktop layout and responsive transformation.
3. Component and state inventory.
4. Exact important copy and status language.
5. Interaction and approval behavior.
6. Accessibility requirements.
7. Visual reference or screenshot when requested.
8. Acceptance checks tied to observable behavior.

For implementation tasks, finish with screenshots at the relevant viewport
sizes and apply the critic rubric. Do not claim high fidelity from code review
alone.
