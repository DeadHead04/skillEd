# Independent UI Critic Rubric

Review the rendered screenshot against the intended user decision and the
Precision Workbench direction. Judge pixels, hierarchy, copy, and state clarity,
not implementation effort.

## Score each dimension from 1 to 5

1. **Decision clarity** — Is the next decision obvious within three seconds?
2. **Evidence hierarchy** — Are summary, failures, and deep evidence ordered by
   importance?
3. **State truth** — Are version, run, approval, partial failure, and candidate
   states unambiguous?
4. **Visual identity** — Does it feel like a precision workbench rather than a
   generic SaaS/AI interface?
5. **Restraint** — Has unnecessary copy, decoration, chrome, and duplicate
   metadata been removed?
6. **Typography and spacing** — Are density, alignment, rhythm, and numerical
   scanning professionally resolved?
7. **Accessibility** — Is status non-color-only, contrast credible, focus/target
   design apparent, and text readable?
8. **Responsive credibility** — Can the hierarchy transform to a narrow screen
   without losing decisions or evidence?

## Automatic deductions

- A single pass score hides a failed dimension.
- Current/candidate or Skill/eval version is missing from a decision screen.
- Chat replaces a structured object or saved decision.
- More than one competing primary action.
- Purple-gradient, glass, or glow styling without product meaning.
- Dense text or charts that do not change a decision.
- Placeholder content prevents judging the real hierarchy.

## Response format

Return the overall score out of 40, the three most consequential visible gaps,
one thing to remove, one thing to preserve, and the single highest-leverage next
iteration. Do not produce a complete redesign unless the screenshot
fundamentally fails the intended decision.
