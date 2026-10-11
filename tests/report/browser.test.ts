import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { HTMLReporter } from "../../src/report/html.js";
import { newInput, newCaseResult } from "../../src/report/reporter.js";
import {
  computeBenchmark,
  extractMetrics,
} from "../../src/report/benchmark.js";
import { newResult } from "../../src/judge/types.js";
test(
  "real Chrome renders report, navigates cases, displays baseline/grades/benchmark and downloads offline feedback",
  { skip: process.env.SKILLED_BROWSER_INTEGRATION !== "1", timeout: 60_000 },
  async (t) => {
    const keep = process.env.SKILLED_REPORT_BROWSER_ARTIFACT_DIR,
      root = keep
        ? path.resolve(keep)
        : await mkdtemp(path.join(os.tmpdir(), "skilled-report-browser-"));
    await mkdir(root, { recursive: true });
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const good = newCaseResult({
          case_id: "case-pass",
          title: "Passing case",
          status: "PASS",
          configuration: "with_skill",
          duration_ms: 1500,
          input_tokens: 50,
          output_tokens: 30,
          grading: newResult([
            {
              text: "Real assertion",
              passed: true,
              evidence: "Visible evidence",
            },
          ]),
          prompt: "<script>window.reportInjection=1</script>",
          response: "Verified answer",
        }),
        bad = newCaseResult({
          case_id: "case-fail",
          title: "Failing case",
          status: "FAIL",
          configuration: "with_skill",
          duration_ms: 2000,
          grading: newResult([
            {
              text: "Expected answer",
              passed: false,
              evidence: "Missing response",
            },
          ]),
          turn_results: [
            {
              turn_number: 1,
              content: "Question",
              response: "Attempt",
              status: "failed",
              reason: "Condition did not match",
            },
          ],
        }),
        baseline = newCaseResult({
          ...good,
          configuration: "without_skill",
          status: "FAIL",
          response: "Baseline answer",
          grading: newResult([
            {
              text: "Real assertion",
              passed: false,
              evidence: "Baseline did not meet it",
            },
          ]),
        });
      const input = newInput({
        skill_name: "Browser validation",
        engine_name: "test-data",
        start_time: "2026-10-11T00:00:00Z",
        end_time: "2026-10-11T00:00:05Z",
        case_results: [good, baseline, bad],
        total_tokens: 80,
        judge_tokens: 20,
        benchmark: computeBenchmark(
          extractMetrics([good, bad]),
          extractMetrics([baseline]),
        ),
      });
      const file = path.join(root, "report.html");
      await new HTMLReporter(file).write(input);
      await page.goto(pathToFileURL(file).href, {
        waitUntil: "domcontentloaded",
      });
      await page
        .locator("#case-info")
        .getByText("case-pass", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("#skill-name").textContent(),
        "Browser validation",
      );
      assert.equal(await page.locator("#case-count").textContent(), "2");
      assert.equal(
        await page
          .locator(".logo")
          .evaluate(
            (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
          ),
        true,
      );
      assert.equal(
        await page.evaluate(() => Object.hasOwn(window, "reportInjection")),
        false,
      );
      assert.match(
        await page.locator("#response-body").innerText(),
        /Baseline answer/,
      );
      await page.locator(".grades-toggle").click();
      assert.match(
        await page.locator("#grades-content").innerText(),
        /Visible evidence/,
      );
      await page.locator("#feedback").fill("First case reviewed");
      await page.locator("#next-btn").click();
      assert.match(await page.locator("#case-info").innerText(), /case-fail/);
      assert.match(await page.locator("#response-body").innerText(), /Attempt/);
      await page.locator("#feedback").fill("Second case reviewed");
      await page.locator('[data-view="benchmark"]').click();
      assert.match(
        await page.locator("#benchmark-content").innerText(),
        /Benchmark Summary/,
      );
      await page.locator('[data-view="cases"]').click();
      await page.locator("#prev-btn").click();
      assert.equal(
        await page.locator("#feedback").inputValue(),
        "First case reviewed",
      );
      await page.locator("#sidebar-toggle").click();
      assert.match(
        (await page.locator("#case-sidebar").getAttribute("class")) ?? "",
        /collapsed/,
      );
      await page.locator("#sidebar-toggle").click();
      await page.waitForFunction(
        () =>
          document.getElementById("case-sidebar")!.getBoundingClientRect()
            .width === 280,
      );
      await page.screenshot({
        path: path.join(root, "report.png"),
        fullPage: true,
      });
      const downloadEvent = page.waitForEvent("download");
      await page.locator("#done-btn").click();
      const download = await downloadEvent;
      const feedbackPath = path.join(root, "feedback.json");
      await download.saveAs(feedbackPath);
      const feedback = JSON.parse(await readFile(feedbackPath, "utf8"));
      assert.equal(feedback.status, "complete");
      assert.equal(feedback.reviews.length, 2);
      assert.equal(feedback.reviews[0].feedback, "First case reviewed");
      assert.equal(feedback.reviews[1].feedback, "Second case reviewed");
      await page.locator("#done-overlay.visible").waitFor();
      assert.deepEqual(errors, []);
      t.diagnostic(
        JSON.stringify({
          browser: await browser.version(),
          report: file,
          feedback: feedbackPath,
          javascriptErrors: errors,
        }),
      );
      await context.close();
    } finally {
      await browser.close();
      if (!keep) await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "real Chrome opens evaluator-generated report artifact and traverses all actual case outcomes",
  { skip: !process.env.SKILLED_REPORT_INTEGRATION_HTML, timeout: 60_000 },
  async (t) => {
    const inputFile = path.resolve(
        process.env.SKILLED_REPORT_INTEGRATION_HTML!,
      ),
      source = await readFile(inputFile, "utf8"),
      data = JSON.parse(source.match(/var DATA = (.*);/)![1]!);
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        }),
        page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(pathToFileURL(inputFile).href, {
        waitUntil: "domcontentloaded",
      });
      assert.equal(
        await page.locator("#case-count").textContent(),
        String(data.cases.length),
      );
      for (let i = 0; i < data.cases.length; i++) {
        await page.locator(`.case-item[data-idx="${i}"]`).click();
        assert.match(
          await page.locator("#case-info").innerText(),
          new RegExp(data.cases[i].id),
        );
        assert.equal(
          await page.locator("#case-badge").textContent(),
          data.cases[i].status,
        );
        if (data.cases[i].turn_results?.length)
          for (const turn of data.cases[i].turn_results)
            assert.ok(
              (await page.locator("#response-body").innerText()).includes(
                turn.response,
              ),
            );
      }
      if (process.env.SKILLED_REPORT_INTEGRATION_SCREENSHOT) {
        const output = path.resolve(
          process.env.SKILLED_REPORT_INTEGRATION_SCREENSHOT,
        );
        await mkdir(path.dirname(output), { recursive: true });
        await page.screenshot({ path: output, fullPage: true });
      }
      assert.deepEqual(errors, []);
      t.diagnostic(
        JSON.stringify({
          browser: await browser.version(),
          inputFile,
          caseCount: data.cases.length,
          summary: data.summary,
          javascriptErrors: errors,
        }),
      );
      await context.close();
    } finally {
      await browser.close();
    }
  },
);
