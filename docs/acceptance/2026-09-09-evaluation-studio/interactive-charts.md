# Interactive results charts

The old results chart rendered one aggregate polygon. Area labels navigated to case filters, but there was no trial or configuration control, no focused preview, and opening a case discarded the chart filter.

The evidence explorer now provides:

- **With Skill**, **Without Skill**, and **Compare both** views, based on the run's recorded configurations. Baseline controls appear only for runs that requested a baseline.
- All-trial and individual-trial views. Chart counts, case evidence and baseline comparisons use the selected sample scope. The headline still reports the entire run, and the stability table explicitly covers all Skill trials.
- Click/tap selection, pointer/focus previews, radar arrow-key navigation, Enter/Space selection, clear-area and full-reset controls. Bars provide the same interactions and exact counts when a radar is inappropriate.
- URL-backed selection for refresh, back/forward, status filters and evidence inspection. Chart and outcome controls share optimistic navigation so rapid clicks cannot restore a stale filter. Selecting an evidence cell opens the matching configuration and trial. Across all trials, a failed area opens its first problematic trial.
- Separate pass, failure, invalid and missing counts. Required observations remain in the denominator. Empty areas say **Not evaluated**; missing or invalid evidence is never green.
- A solid Skill series and dashed baseline series. Equal pass rates are explicitly described as overlapping; the display does not invent variation or baseline benefit.
- Responsive layouts and a fixed preview footprint so focusing a bar does not move the pointer target. The layout responds to available panel width, including zoom and an open inspector.

## Try the saved product-review run

Open [the comparison](http://127.0.0.1:3400/runs/5089cc17-614d-45f8-b15b-af761d56b8af?skill=73c18135-4cd0-4bd4-9461-c1d8205abf08&view=compare).

1. Choose **Compare both**, then **Trial 2**. Decision accuracy changes from **10/16** to **5/8** passed for each configuration.
2. Select **Decision accuracy**. The case table shows only applicable cases. Hover or focus another area to preview it without changing the filter.
3. Open a **Without Skill** evidence cell. The inspector opens the baseline's trial 2. Press Escape to return with the chart selection preserved.
4. Try an outcome filter, refresh, and browser back/forward. Use **Reset view** to restore all areas and trials.

The saved run is **Demo evidence**. Its two trials and baseline have identical outcomes, so the polygon ratios legitimately overlap even though the controls change the selected observations. These interactions do not certify model quality or change the real-execution gate.

## Verification

The complete journey also exposed a proposal-refresh race: a verification job could finish between the proposal read and the active-job read, leaving no event stream to update the screen. Proposal pages now recover from durable status with bounded requests and retries. Acceptance explicitly drops the verification event stream and refreshes the page before activation.

The browser regression helper is `apps/web/e2e/evidence-interactions.ts`, included in the complete upload-to-activation journey. It independently reconciles every displayed area/configuration/trial count against stored assertion IDs and checks linked cases, the correct inspector sample, keyboard/touch selection, refresh, history navigation and reset. Core tests exercise different trial outcomes, missing samples, duplicate samples, malformed assertions, baseline aliases and invalid trial selection.

See `interactive-chart-checks.json` for final check results and screenshot references. Earlier studio acceptance evidence remains preserved separately.
