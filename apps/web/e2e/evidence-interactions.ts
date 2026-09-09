import { expect, type Page } from "@playwright/test";

// Reconcile the displayed slices against the stored assertions, without using
// the production summary function. No model calls or history mutations.
export async function inspectInteractiveEvidence(page: Page) {
  const runId = new URL(page.url()).pathname.split("/").pop()!;
  const run = await (await page.request.get(`/api/v1/runs/${runId}`)).json();
  const evaluation = await (
    await page.request.get(`/api/v1/evals/${run.eval_version_id}`)
  ).json();
  const cases = evaluation.cases.filter((c: any) =>
    (
      run.settings?.selectedCaseIds ??
      evaluation.cases.filter((v: any) => v.enabled).map((v: any) => v.case_id)
    ).includes(c.case_id),
  );
  const chart = page.getByRole("region", { name: "Judging area evidence" });
  const matrix = page.getByRole("region", {
    name: "Case evidence",
    exact: true,
  });
  const firstBar = chart.locator(".area-bar").first();
  const areaId = (await firstBar.getAttribute("data-area"))!;
  const bars = chart.locator(".area-bar");
  const expectedCounts = (id: string, config: string, trial?: number) => {
    let expected = 0,
      passed = 0;
    for (const c of cases) {
      const definitions = Object.values(c.assertion_mapping).filter(
        (a: any) => (a.areaId ?? a.dimension) === id && a.required !== false,
      ) as any[];
      expected += definitions.length * (trial ? 1 : run.iterations);
      for (const n of trial
        ? [trial]
        : Array.from({ length: run.iterations }, (_, i) => i + 1)) {
        const rows = run.results.filter(
          (r: any) =>
            r.case_id === c.case_id &&
            r.iteration === n &&
            (config === "skill"
              ? ["skill", "with_skill"]
              : ["baseline", "without_skill"]
            ).includes(r.configuration),
        );
        if (rows.length !== 1 || rows[0].result === "ERROR") continue;
        for (const d of definitions) {
          const observations = rows[0].assertions.filter(
            (a: any) => a.id === d.id,
          );
          if (
            observations.length === 1 &&
            observations[0].passed === true &&
            !observations[0].error
          )
            passed++;
        }
      }
    }
    return expected ? `${passed}/${expected} passed` : "Not evaluated";
  };
  const reconcile = async (configs: string[], trial?: number) => {
    for (const bar of await bars.all()) {
      const id = (await bar.getAttribute("data-area"))!;
      for (const config of configs)
        await expect(
          bar.locator(`[data-series="${config}"] .area-series-head`),
        ).toContainText(expectedCounts(id, config, trial));
    }
  };
  await reconcile(["skill"]);
  await firstBar.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`dim=${areaId}`));
  await expect(firstBar).toHaveAttribute("aria-pressed", "true");
  await expect(matrix.getByRole("columnheader")).toHaveCount(3);
  const areaCases = cases.filter((c: any) =>
    Object.values(c.assertion_mapping).some(
      (a: any) => (a.areaId ?? a.dimension) === areaId && a.required !== false,
    ),
  );
  await expect(matrix.locator("tbody tr")).toHaveCount(areaCases.length);

  await chart.getByLabel("Chart trial").selectOption("2");
  await expect(matrix).toContainText("Trial 2");
  await expect(page).toHaveURL(/evidenceTrial=2/);
  await reconcile(["skill"], 2);
  await chart
    .getByRole("button", { name: "Without Skill", exact: true })
    .click();
  await expect(matrix).toContainText("Without Skill");
  await reconcile(["baseline"], 2);
  await chart
    .getByRole("button", { name: "Compare both", exact: true })
    .click();
  await expect(matrix).toContainText("Both configurations");
  await reconcile(["skill", "baseline"], 2);
  await expect(chart.locator("polygon[data-series]")).toHaveCount(2);
  await page.reload();
  await expect(chart.getByLabel("Chart trial")).toHaveValue("2");
  await expect(
    chart.getByRole("button", { name: "Compare both", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(firstBar).toHaveAttribute("aria-pressed", "true");
  await reconcile(["skill", "baseline"], 2);

  const baselineLink = matrix
    .locator('tbody a.matrix-observation[href*="configuration=baseline"]')
    .first();
  await baselineLink.click();
  const inspector = page.getByRole("complementary", { name: "Evidence" });
  await expect(inspector).toBeVisible();
  await expect(page).toHaveURL(/configuration=baseline/);
  await expect(page).toHaveURL(/(?:\?|&)trial=2/);
  await expect(
    inspector.getByRole("link", { name: "Trial 2", exact: true }),
  ).toHaveClass(/on/);
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  await expect(chart.getByLabel("Chart trial")).toHaveValue("2");
  await expect(firstBar).toHaveAttribute("aria-pressed", "true");

  await matrix.getByRole("link", { name: "Fail", exact: true }).click();
  await expect(page).toHaveURL(/status=FAIL/);
  await expect(page).toHaveURL(new RegExp(`dim=${areaId}`));
  await expect(chart.getByLabel("Chart trial")).toHaveValue("2");
  await matrix.getByRole("link", { name: "All", exact: true }).click();
  await chart.getByRole("button", { name: "Clear area filter" }).click();
  await expect(firstBar).toHaveAttribute("aria-pressed", "false");
  await expect(matrix.locator("tbody tr")).toHaveCount(cases.length);
  await page.goBack();
  await expect(firstBar).toHaveAttribute("aria-pressed", "true");
  await page.goForward();
  await expect(firstBar).toHaveAttribute("aria-pressed", "false");

  const axes = chart.locator(".radar-axis");
  if (await axes.count()) {
    await axes.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(axes.nth(1)).toBeFocused();
    await expect(chart.getByTestId("chart-area-detail")).toContainText(
      (await bars.nth(1).locator(".area-bar-head span").first().textContent())!,
    );
    await page.keyboard.press("Enter");
    await expect(bars.nth(1)).toHaveAttribute("aria-pressed", "true");
  }
  await chart.getByRole("button", { name: "Reset view" }).click();
  await expect(chart.getByLabel("Chart trial")).toHaveValue("0");
  await expect(matrix.getByRole("columnheader")).toHaveCount(
    (await bars.count()) + 2,
  );
  await expect(matrix.locator("tbody tr")).toHaveCount(cases.length);
  await reconcile(["skill"]);
  await expect(page).not.toHaveURL(/(?:dim|view|evidenceTrial|status)=/);
  // A mouse/touch selection must still land after the controls and preview
  // change size; focusing a bar must not move it out from under the pointer.
  await chart
    .getByRole("button", { name: "Compare both", exact: true })
    .click();
  await chart.getByLabel("Chart trial").selectOption("2");
  await firstBar.click();
  await expect(firstBar).toHaveAttribute("aria-pressed", "true");
  await expect(matrix.getByRole("columnheader")).toHaveCount(3);
  await chart.getByRole("button", { name: "Reset view" }).click();
  await expect(firstBar).toHaveAttribute("aria-pressed", "false");
  await expect(matrix.locator("tbody tr")).toHaveCount(cases.length);
}
