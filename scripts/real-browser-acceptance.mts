/** Explicit, staged real browser acceptance. Never included in normal CI. */
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

assert.ok(
  process.argv.includes("--real"),
  "Real model acceptance requires --real",
);
const stage = process.argv[2] ?? "inspect";
const baseURL = process.env.SKILLED_REAL_BROWSER_URL ?? "http://127.0.0.1:3600";
assert.equal(new URL(baseURL).hostname, "127.0.0.1");
assert.notEqual(
  new URL(baseURL).port,
  "3000",
  "Preserve the original installation",
);
const root = resolve("docs/acceptance/2026-09-10-codex-docker/browser");
await mkdir(root, { recursive: true });
const statePath = join(root, "state.json");
const state: Record<string, string> = JSON.parse(
  await readFile(statePath, "utf8").catch(() => "{}"),
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const save = async () =>
  writeFile(statePath, JSON.stringify(state, null, 2) + "\n");
async function decide(name: string | RegExp) {
  const received = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/v1/"),
  );
  await page.getByRole("button", { name, exact: true }).click();
  const response = await received;
  assert.ok(response.ok(), (await response.text()).slice(0, 2000));
}
async function snapshot(label: string) {
  await expect(
    page.getByRole("heading", { name: "Loading your workspace", exact: true }),
  ).toBeHidden();
  state.url = page.url();
  await save();
  await page.screenshot({ path: join(root, label + ".png"), fullPage: true });
  await writeFile(
    join(root, label + ".txt"),
    await page.locator("body").innerText(),
  );
  for (const [key, route] of [
    ["evalId", "evals"],
    ["runId", "runs"],
    ["proposalId", "improve"],
  ]) {
    if (!state[key!]) continue;
    const viewedRun = new URL(page.url()).pathname.match(
      /^\/runs\/([0-9a-f-]+)$/,
    )?.[1];
    const resourceId = key === "runId" && viewedRun ? viewedRun : state[key!];
    const response = await page.request.get(`/api/v1/${route}/${resourceId}`);
    if (response.ok())
      await writeFile(
        join(root, label + "-" + route + ".json"),
        JSON.stringify(await response.json(), null, 2) + "\n",
      );
  }
  console.log(JSON.stringify(state));
}
try {
  await page.goto("/login");
  await page.getByLabel("Login ID").fill("admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("deterministic-test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  const health = await (await page.request.get("/api/v1/health")).json();
  assert.equal(health.execution, "ready", JSON.stringify(health));
  if (stage === "intake") {
    assert.ok(
      !state.evalId,
      "Continue the existing evaluation instead of creating duplicate work",
    );
    const materials = resolve("examples/manual-skill-evaluation");
    await page.goto("/skill?new=1");
    await page
      .getByLabel("Skill ZIP")
      .setInputFiles(join(materials, "manual-product-qc.zip"));
    await page
      .getByLabel("What should this Skill reliably accomplish?")
      .fill(
        "Review the supplied synthetic product cards against their source facts and write review.json with a reviews array. Each review contains id, decision (PASS or FAIL), and findings (an array of objects with source_id and reason). Correctly reject unsupported claims, missing mandatory warnings and changed protected fields; only the fully supported card passes. Cite F2 for an unsupported clinical claim, F3 for the missing peanut warning, and sku for SKU drift. A correct rejection is a passing evaluation result. Preserve every input file byte for byte. The tested agent receives the source facts and authority, but must not see expected-review.json. For this small real acceptance suite propose exactly TWO cases using concrete script validators: one batch covering all four supplied cards (normal and adversarial behavior), and one boundary case with missing source evidence that must be rejected with an explanation. Use one trial initially; candidate verification will use three. Propose task-specific judging areas, validate the output decisions and cited source identifiers, protect input files, and require an actual review.json artifact. These task instructions and the JSON output contract must be supplied in every relevant case prompt. No dependencies or network calls are needed.",
      );
    const names = [
      "product-cards.json",
      "authority.md",
      "past-failures.md",
      "expected-review.json",
    ];
    await page
      .getByLabel(
        "Task materials (dataset, authority, examples, or expected outputs)",
      )
      .setInputFiles(names.map((name) => join(materials, name)));
    for (const [name, kind] of [
      ["product-cards.json", "dataset"],
      ["authority.md", "authority"],
      ["past-failures.md", "past_failure"],
      ["expected-review.json", "expected"],
    ])
      await page.getByLabel(name + " provides").selectOption(kind!);
    await page
      .getByRole("button", { name: "Upload and inspect", exact: true })
      .click();
    await page.waitForURL(/\/skill\?skill=/);
    state.skillId = new URL(page.url()).searchParams.get("skill")!;
    await save();
    await page
      .getByRole("button", { name: "Create evals", exact: true })
      .click();
    await page.waitForURL(/\/evals\/[0-9a-f-]+/);
    state.evalId = new URL(page.url()).pathname.split("/").pop()!;
  } else {
    assert.ok(state.evalId, "Run intake first");
    const target =
      [
        "launch",
        "results",
        "improve",
        "verify-initial",
        "activate-initial",
      ].includes(stage) && state.runId
        ? `/runs/${state.runId}?skill=${state.skillId}`
        : ["approve-candidate", "verify", "activate", "proposal"].includes(
              stage,
            ) && state.proposalId
          ? `/improve/${state.proposalId}?skill=${state.skillId}`
          : `/evals/${state.evalId}?skill=${state.skillId}`;
    await page.goto(target);
    if (stage === "output-preview") {
      await page.goto(`/runs/${state.baselineRunId}?skill=${state.skillId}`);
      await page
        .getByRole("link", {
          name: "Four-card grounded product QC batch",
          exact: true,
        })
        .first()
        .click();
      await page
        .getByRole("button", { name: "review.json", exact: true })
        .click();
      await expect(
        page.locator("pre.file-view").filter({ hasText: '"reviews"' }),
      ).toContainText('"unsupported-claim"');
    }
    if (stage === "baseline-evidence" || stage === "verification-evidence") {
      const verification = stage === "verification-evidence";
      const label = verification ? "verification" : "baseline";
      const id = verification
        ? state.runId
        : (state.baselineRunId ?? state.runId);
      assert.ok(id);
      const run = await (await page.request.get(`/api/v1/runs/${id}`)).json();
      assert.equal(run.status, "completed");
      assert.equal(run.results.length, verification ? 6 : 4);
      if (verification) {
        assert.equal(run.iterations, 3);
        assert.equal(run.baseline, false);
        const baseline = await (
          await page.request.get(`/api/v1/runs/${state.baselineRunId}`)
        ).json();
        for (const key of ["skill_checksum", "eval_checksum", "model"])
          assert.equal(run[key], baseline[key]);
        assert.equal(run.settings.profileHash, baseline.settings.profileHash);
        assert.equal(
          new Set(
            run.results.map(
              (r: any) => `${r.case_id}:${r.configuration}:${r.iteration}`,
            ),
          ).size,
          6,
        );
      }
      const summaries = [];
      for (const result of run.results) {
        assert.equal(result.result, "PASS");
        assert.ok(result.assertions.every((a: any) => a.passed && !a.error));
        const artifact = result.artifacts.find((a: any) =>
          a.key.endsWith("/workspace/review.json"),
        );
        assert.ok(artifact, "Real review.json output required");
        const response = await page.request.get(
          `/api/v1/runs/${id}/artifact?key=${encodeURIComponent(artifact.key)}`,
        );
        assert.ok(response.ok());
        const bytes = await response.body();
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          artifact.checksum,
        );
        const preview = await (
          await page.request.get(
            `/api/v1/runs/${id}/artifact?key=${encodeURIComponent(artifact.key)}&preview=1`,
          )
        ).json();
        assert.deepEqual(
          JSON.parse(preview.text),
          JSON.parse(bytes.toString()),
        );
        await writeFile(
          join(
            root,
            `${label}-${result.case_id}-${result.configuration}-${result.iteration}-review.json`,
          ),
          bytes,
        );
        summaries.push({
          caseId: result.case_id,
          configuration: result.configuration,
          iteration: result.iteration,
          assertions: result.assertions.length,
          outputChecksum: artifact.checksum,
        });
      }
      const archive = await page.request.get(`/api/v1/runs/${id}/download`);
      assert.ok(archive.ok());
      await writeFile(
        join(root, `${label}-raw-report.zip`),
        await archive.body(),
      );
      await writeFile(
        join(root, `${label}-evidence-summary.json`),
        JSON.stringify({ runId: id, samples: summaries }, null, 2),
      );
      await page.goto(`/runs/${id}?skill=${state.skillId}`);
    }
    if (stage === "clone-fixture-correction") {
      assert.ok(!state.sourceEvalId, "Inspect the existing correction clone");
      const response = await page.request.post(
        `/api/v1/evals/${state.evalId}/clone`,
        {
          data: { preserveCases: true },
          headers: { "idempotency-key": `fixture-correction-${state.evalId}` },
        },
      );
      assert.ok(response.ok(), await response.text());
      state.sourceEvalId = state.evalId;
      state.failedSetupRunId = state.runId!;
      state.evalId = (await response.json()).resourceId;
      delete state.runId;
      await save();
      await page.goto(`/evals/${state.evalId}?skill=${state.skillId}`);
    }
    if (stage === "review-boundary-validator") {
      const evaluation = await (
        await page.request.get(`/api/v1/evals/${state.evalId}`)
      ).json();
      assert.equal(evaluation.status, "ready");
      const original = evaluation.cases.find(
        (item: any) => item.case_id === "PRODUCT-QC-BOUNDARY-001",
      ).source;
      const source = structuredClone(original);
      const check = source.deterministicChecks.find(
        (item: any) => item.assertionId === "boundary_contract_001",
      );
      const schema = JSON.parse(check.value);
      schema.additionalProperties = false;
      check.value = JSON.stringify(schema);
      await writeFile(
        join(root, "reviewed-boundary-change.json"),
        JSON.stringify(
          {
            before: original,
            after: source,
            rationale: "Enforce the declared single top-level reviews field.",
          },
          null,
          2,
        ),
      );
      const response = await page.request.patch(
        `/api/v1/evals/${state.evalId}/cases/PRODUCT-QC-BOUNDARY-001`,
        { data: { expectedRevision: evaluation.revision, source } },
      );
      assert.ok(response.ok(), await response.text());
      await page.reload();
    }
    if (stage === "review-validators") {
      const evaluation = await (
        await page.request.get(`/api/v1/evals/${state.evalId}`)
      ).json();
      assert.equal(evaluation.status, "ready");
      const original = evaluation.cases.find(
        (item: any) => item.case_id === "PRODUCT-QC-BATCH-001",
      ).source;
      const source = structuredClone(original);
      const citationLabels: Record<string, string> = {
        batch_f2_001:
          "The unsupported-claim review contains a finding with source_id F2 and a nonempty reason. Threshold: at least one exact source-ID match; reason meaning is not semantically graded.",
        batch_f3_001:
          "The missing-warning review contains a finding with source_id F3 and a nonempty reason. Threshold: at least one exact source-ID match; reason meaning is not semantically graded.",
        batch_sku_001:
          "The protected-drift review contains a finding with source_id sku and a nonempty reason. Threshold: at least one exact source-ID match; reason meaning is not semantically graded.",
      };
      for (const assertion of source.assertions)
        if (citationLabels[assertion.id])
          assertion.text = citationLabels[assertion.id];
      source.criteria = source.assertions.map(
        (assertion: any) => assertion.text,
      );
      const check = source.deterministicChecks.find(
        (item: any) => item.assertionId === "batch_contract_001",
      );
      const schema = JSON.parse(check.value);
      schema.additionalProperties = false;
      schema.properties.reviews.prefixItems = [
        "supported",
        "unsupported-claim",
        "missing-warning",
        "protected-drift",
      ].map((id) => ({
        ...schema.properties.reviews.items,
        properties: {
          ...schema.properties.reviews.items.properties,
          id: { const: id },
        },
      }));
      check.value = JSON.stringify(schema);
      await writeFile(
        join(root, "reviewed-validator-change.json"),
        JSON.stringify(
          {
            before: original,
            after: source,
            rationale:
              "Align citation labels with actual mechanical checks and enforce the public JSON root/order contract. No semantic-accuracy claim is made for free-form reasons.",
          },
          null,
          2,
        ),
      );
      const response = await page.request.patch(
        `/api/v1/evals/${state.evalId}/cases/PRODUCT-QC-BATCH-001`,
        { data: { expectedRevision: evaluation.revision, source } },
      );
      assert.ok(response.ok(), await response.text());
      await page.reload();
    }
    if (stage === "understand")
      await page
        .getByRole("button", { name: "Start understanding", exact: true })
        .click();
    if (stage === "request-change") {
      await page
        .getByRole("link", { name: "Request change ↗" })
        .first()
        .click();
      await page
        .getByLabel("Message Codex")
        .fill(await readFile(join(root, "requested-revision.txt"), "utf8"));
      await page
        .getByRole("button", { name: "Send to Codex", exact: true })
        .click();
    }
    if (stage === "apply-revision") {
      await page
        .getByRole("link", { name: "Request change ↗" })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Apply proposed revision", exact: true })
        .last()
        .click();
    }
    if (stage === "generate")
      await page
        .getByRole("button", { name: "Generate evals", exact: true })
        .click();
    if (stage === "retry")
      await page
        .getByRole("button", { name: "Retry generation", exact: true })
        .click();
    if (stage === "approve-eval") await decide("Approve evals");
    if (stage === "launch" || stage === "verify-initial") {
      if (stage === "launch")
        assert.ok(!state.runId, "Use results to inspect the existing run");
      else {
        assert.ok(
          !state.baselineRunId,
          "Inspect the existing verification run",
        );
        state.baselineRunId = state.runId!;
      }
      await page.goto(`/runs/new?skill=${state.skillId}&eval=${state.evalId}`);
      await page
        .getByLabel("Repeated trials")
        .selectOption(stage === "verify-initial" ? "3" : "1");
      await page
        .getByLabel("Include a baseline without the Skill")
        .setChecked(stage !== "verify-initial");
      await page
        .getByRole("button", { name: "Launch evaluation", exact: true })
        .click();
      await page.waitForURL(/\/runs\/[0-9a-f-]+/);
      state.runId = new URL(page.url()).pathname.split("/").pop()!;
    }
    if (stage === "improve") {
      await page
        .getByRole("button", { name: "Suggest update", exact: true })
        .click();
      await page.waitForURL(/\/improve\/[0-9a-f-]+/);
      state.proposalId = new URL(page.url()).pathname.split("/").pop()!;
    }
    if (stage === "approve-candidate") await decide(/Approve Skill only/i);
    if (stage === "verify") await decide(/Verify candidate/i);
    if (stage === "activate") await decide(/Activate candidate/i);
    if (stage === "activate-initial") {
      await decide("Activate tested version");
      await page.waitForURL(/\/release\?/);
      await expect(
        page.getByText("An upload does not become active automatically.", {
          exact: true,
        }),
      ).toBeHidden();
      const download = page.waitForEvent("download");
      await page
        .getByRole("link", { name: "Download ↓", exact: true })
        .first()
        .click();
      await (await download).saveAs(join(root, "activated-skill.zip"));
    }
  }
  await expect(page.locator("body")).toBeVisible();
  await snapshot(stage);
} catch (error) {
  await snapshot(stage + "-error").catch(() => undefined);
  throw error;
} finally {
  await context.close();
  await browser.close();
}
