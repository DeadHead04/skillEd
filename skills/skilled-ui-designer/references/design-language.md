# Visual Direction: Precision Workbench

## Intent

SkillEd should feel like a calm instrument used to inspect and improve a complex
system: rigorous enough for technical evidence, composed enough for long review
sessions, and distinctive without ornamental futurism.

The visual metaphor is an editorial evidence desk crossed with a precision lab
console. Use the metaphor through composition and interaction, not literal
equipment illustrations.

## Palette

- `Ink 950` `#111614`: primary dark navigation and strong text.
- `Graphite 800` `#26302C`: secondary dark surfaces.
- `Paper 50` `#F4F1E8`: main light working surface.
- `Paper 100` `#EAE5D8`: grouped or inset surface.
- `Signal cyan` `#35C2B2`: active/running/selected, used sparingly.
- `Safety coral` `#F36D4A`: failure, regression, or destructive warning.
- `Evidence blue` `#5A8DEE`: grounded informational evidence.
- `Amber` `#D8A83E`: needs attention or provisional evidence.

Avoid full-page gradients. Color should encode state or guide attention, not
fill empty space.

## Typography

- Product and data UI: a compact neutral grotesk with tabular numerals.
- IDs, timings, file paths, YAML, and diffs: a restrained monospace.
- Optional editorial display face only for the page-level title or empty state;
  never for dense controls or tables.
- Keep headings compact. The product is a workbench, not a landing page.

## Layout grammar

- Narrow dark navigation rail.
- Light primary work surface with visible paper-like hierarchy.
- Persistent context strip for Skill version, eval version, and worker state.
- Main content and a collapsible evidence inspector rather than many equal
  cards.
- Hairline dividers, aligned baselines, and grouped rows create structure.
- Use cards only for a self-contained decision; do not wrap every section.

## Component character

- Corners: 6–10px for interactive surfaces; avoid uniformly large pills.
- Borders: one-pixel neutral lines with stronger selected edges.
- Buttons: compact, tactile, high-contrast; only one solid primary per view.
- Status: small geometric signal plus explicit label, never color alone.
- Tables: comfortable row height, sticky headers, aligned metrics, expandable
  evidence rows.
- Diffs: paper/ink base with quiet green additions and coral deletions; preserve
  code legibility.
- Charts: only for comparison or repeated-trial distributions; direct labels,
  no legends when labels can sit on marks.

## Motion

- 120–180ms for local control feedback.
- 220–320ms for panel changes or evidence-inspector transitions.
- Running activity uses a restrained scan/progress signal, not pulsing glows.
- Respect reduced motion and never animate numeric results in a way that delays
  reading.

## Image generation

Use ImageGen for direction boards and mood references, especially to explore
material, composition, and visual tension. Do not ship generated screenshots as
the interface. Generated imagery should not introduce brand marks, tiny body
copy, robots, sparkles, or decorative 3D objects unrelated to evaluation.

## Visual references

Inspect only the reference relevant to the screen being designed. These images
set composition, density, and material quality; the screen blueprints and
product data remain authoritative for copy, controls, and state.

- [`direction-board.png`](../assets/direction-board.png) compares the three
  explored directions. `Precision Workbench` is the selected direction.
- [`eval-authoring.png`](../assets/eval-authoring.png) establishes the split
  between guided conversation, durable case structure, and source evidence.
- [`results-failure-analysis.png`](../assets/results-failure-analysis.png)
  demonstrates the required false-green treatment: a repaired target remains
  `Partial` when scope preservation fails.
- [`candidate-comparison.png`](../assets/candidate-comparison.png) demonstrates
  regression-first comparison and a blocked activation decision.

Never reproduce text from these images without checking it against
[`screen-blueprints.md`](screen-blueprints.md). Image-generated microcopy and
numbers are illustrative.

## Signs the direction has drifted

- The page reads as a generic analytics dashboard.
- Chat occupies the entire experience and hides structured state.
- More than three card styles compete on one screen.
- Every status is a colored pill.
- Decorative effects overpower exact versions, evidence, or approval state.
- A user cannot identify the next decision within three seconds.
