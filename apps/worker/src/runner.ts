import {
  ArtifactStore,
  canonicalScriptJudgePath,
  createZip,
  emit,
  deriveResult,
  extractZip,
  matchesCanonicalScriptJudgePath,
  SCRIPT_JUDGE_BASE_PATH,
  type Db,
} from "@skilled/core";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildExecutionSlots,
  createSkillUpProgressParser,
} from "./run-progress.js";

export async function runEvaluation(sql: Db, job: Record<string, any>) {
  const [run] =
    await sql`SELECT r.*,sv.status skill_status FROM runs r JOIN skill_versions sv ON sv.id=r.skill_version_id WHERE r.id=${job.resource_id}`;
  if (!run) throw new Error("Run not found");
  if (process.env.SKILLED_ADAPTER_MODE !== "fake") {
    await runRealEvaluation(sql, job, run);
    await finalizeVerification(sql, run.id);
    return;
  }
  await sql`UPDATE runs SET engine_versions=${sql.json({ adapter: "demo", engine: "deterministic-fake" })} WHERE id=${run.id}`;
  await sql`UPDATE runs SET status='preparing',started_at=now() WHERE id=${run.id}`;
  await emit(sql, job.id, "stage_changed", { stage: "preparing" });
  const cases =
    await sql`SELECT * FROM eval_cases WHERE eval_version_id=${run.eval_version_id} AND enabled=true ORDER BY case_id`;
  await sql`UPDATE runs SET status='running' WHERE id=${run.id}`;
  await emit(sql, job.id, "stage_changed", {
    stage: "running",
    total: cases.length * run.iterations,
  });
  let completed = 0;
  for (let iteration = 1; iteration <= run.iterations; iteration++)
    for (const [caseOffset, item] of cases.entries()) {
      const [fresh] =
        await sql`SELECT cancel_requested_at FROM jobs WHERE id=${job.id}`;
      if (fresh?.cancel_requested_at) {
        await sql`UPDATE runs SET status='cancelled',completed_at=now() WHERE id=${run.id}`;
        await sql`UPDATE jobs SET status='cancelled',completed_at=now() WHERE id=${job.id}`;
        await emit(sql, job.id, "stage_changed", { stage: "cancelled" });
        await emit(sql, job.id, "completed", { cancelled: true, completed });
        return;
      }
      await emit(sql, job.id, "case_started", {
        caseId: item.case_id,
        index: caseOffset + 1,
        configuration: "with_skill",
        iteration,
        total: cases.length,
        provisional: true,
      });
      const falseGreen = String(item.case_id).startsWith("FG-");
      const scopeDrift = item.case_id === "FG-004";
      const candidateSkill = run.skill_status === "candidate";
      const assertions = (item.required_dimensions as string[]).map(
        (dimension) => ({
          id: `${item.case_id}-${dimension}`,
          dimension,
          required: true,
          passed:
            !candidateSkill && scopeDrift && dimension === "scope"
              ? false
              : !candidateSkill &&
                  falseGreen &&
                  !scopeDrift &&
                  dimension === "correctness"
                ? false
                : true,
        }),
      );
      const result = deriveResult(assertions);
      const dimensions = Object.fromEntries(
        assertions.map((a) => [a.dimension, a.passed]),
      );
      await sql`INSERT INTO case_results(run_id,case_id,configuration,iteration,result,assertions,dimensions,stable,tokens,duration_ms,detail) VALUES(${run.id},${item.case_id},'skill',${iteration},${result},${sql.json(assertions)},${sql.json(dimensions)},true,${sql.json({ input: 1200, output: 240 })},${900 + completed * 41},${sql.json({ prompt: item.source?.prompt, response: falseGreen ? "Approved without sufficient grounded evidence." : "Completed with cited evidence.", evidence: item.evidence_provenance })})`;
      completed++;
      await emit(sql, job.id, "case_completed", {
        caseId: item.case_id,
        index: caseOffset + 1,
        configuration: "with_skill",
        iteration,
        reportedStatus: result === "PASS" ? "PASS" : "FAIL",
        total: cases.length,
        provisional: true,
      });
    }
  await sql`UPDATE runs SET status='finalizing' WHERE id=${run.id}`;
  await emit(sql, job.id, "stage_changed", { stage: "finalizing" });
  const normalized =
    await sql`SELECT case_id,configuration,iteration,result,assertions,dimensions,tokens,duration_ms,error_class,detail FROM case_results WHERE run_id=${run.id} ORDER BY case_id,iteration`;
  const store = new ArtifactStore();
  const normalizedKey = `runs/${run.id}/normalized.json`;
  await store.put(
    normalizedKey,
    Buffer.from(
      JSON.stringify(
        {
          runId: run.id,
          skillChecksum: run.skill_checksum,
          evalChecksum: run.eval_checksum,
          results: normalized,
        },
        null,
        2,
      ),
    ),
  );
  const reportDir = join(
    process.env.WORK_ROOT ?? "/data/work",
    `report-${run.id}`,
  );
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    join(reportDir, "result.json"),
    JSON.stringify(
      { schema_version: "skilled-v1", case_results: normalized },
      null,
      2,
    ),
  );
  await writeFile(
    join(reportDir, "report.html"),
    `<!doctype html><meta charset="utf-8"><title>SkillEd run ${run.id}</title><h1>SkillEd normalized evidence report</h1><pre>${escapeHtml(JSON.stringify(normalized, null, 2))}</pre>`,
  );
  const rawBundle = join(reportDir, "raw-report.zip");
  await createZip(reportDir, ["result.json", "report.html"], rawBundle);
  const rawKey = `runs/${run.id}/raw-report.zip`;
  await store.put(rawKey, await readFile(rawBundle));
  await rm(reportDir, { recursive: true, force: true });
  await sql`UPDATE runs SET status='completed',completed_at=now(),raw_report_key=${rawKey},normalized_key=${normalizedKey} WHERE id=${run.id}`;
  await finalizeVerification(sql, run.id);
  await emit(sql, job.id, "stage_changed", { stage: "completed" });
  await emit(sql, job.id, "completed", { resourceId: run.id, completed });
}

async function finalizeVerification(sql: Db, runId: string) {
  const proposals =
    await sql`SELECT * FROM update_proposals WHERE status='verifying' AND (current_verification_run_id=${runId} OR candidate_verification_run_id=${runId})`;
  for (const proposal of proposals) {
    const [current] =
      await sql`SELECT status FROM runs WHERE id=${proposal.current_verification_run_id}`;
    const [candidate] =
      await sql`SELECT status FROM runs WHERE id=${proposal.candidate_verification_run_id}`;
    if (current?.status === "completed" && candidate?.status === "completed") {
      const before =
        await sql`SELECT case_id,result FROM case_results WHERE run_id=${proposal.current_verification_run_id}`;
      const after =
        await sql`SELECT case_id,result FROM case_results WHERE run_id=${proposal.candidate_verification_run_id}`;
      const rank: Record<string, number> = {
        PASS: 0,
        PARTIAL: 1,
        FAIL: 2,
        ERROR: 3,
      };
      const caseIds = [
        ...new Set([...before, ...after].map((value) => value.case_id)),
      ];
      const worst = (rows: Record<string, any>[], caseId: string) =>
        rows
          .filter((value) => value.case_id === caseId)
          .map((value) => value.result)
          .sort((a, b) => (rank[b] ?? 3) - (rank[a] ?? 3))[0] ?? "ERROR";
      const unstable = (rows: Record<string, any>[], caseId: string) =>
        new Set(
          rows
            .filter((value) => value.case_id === caseId)
            .map((value) => value.result),
        ).size > 1;
      const comparison = caseIds.map((caseId) => {
        const old = worst(before, caseId);
        const next = worst(after, caseId);
        return {
          caseId,
          current: old,
          candidate: next,
          category:
            unstable(before, caseId) || unstable(after, caseId)
              ? "Flaky"
              : rank[next]! < rank[old]!
                ? "Fixed"
                : rank[next]! > rank[old]!
                  ? "Regressed"
                  : "Unchanged",
        };
      });
      const blocked = comparison.some(
        (item) => item.category === "Regressed" || item.candidate === "ERROR",
      );
      await sql`UPDATE update_proposals SET status=${blocked ? "failed" : "verified"},comparison=${sql.json({ cases: comparison, blocked })},updated_at=now() WHERE id=${proposal.id}`;
    }
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function runRealEvaluation(
  sql: Db,
  job: Record<string, any>,
  run: Record<string, any>,
) {
  await sql`UPDATE runs SET engine_versions=${sql.json({ adapter: "real", engine: "codex", skillUp: "vendored" })} WHERE id=${run.id}`;
  await sql`UPDATE runs SET status='preparing',started_at=COALESCE(started_at,now()) WHERE id=${run.id}`;
  await emit(sql, job.id, "stage_changed", { stage: "preparing" });
  const [inputs] =
    await sql`SELECT sv.installable_key,sv.selected_root,ev.bundle_key FROM skill_versions sv JOIN eval_versions ev ON ev.id=${run.eval_version_id} WHERE sv.id=${run.skill_version_id}`;
  if (!inputs?.installable_key || !inputs?.bundle_key)
    throw new Error("Pinned Skill or eval artifact is missing");
  const cases =
    await sql`SELECT case_id FROM eval_cases WHERE eval_version_id=${run.eval_version_id} AND enabled=true ORDER BY case_id`;
  const slots = buildExecutionSlots(
    cases.map((item) => String(item.case_id)),
    Boolean(run.baseline),
  );
  const store = new ArtifactStore();
  const operation = join(
    process.env.WORK_ROOT ?? "/data/work",
    `run-${run.id}`,
  );
  const skillRoot = join(operation, inputs.selected_root ?? "");
  await mkdir(operation, { recursive: true });
  try {
    await extractZip(store.path(inputs.installable_key), operation);
    await extractZip(store.path(inputs.bundle_key), skillRoot, {
      requireSkill: false,
    });
    const output = join(operation, "skill-up-output");
    const args = [
      "run",
      join(skillRoot, "evals/eval.yaml"),
      "--engine",
      "codex",
      "--model",
      run.model,
      "--runtime",
      "none",
      "--parallelism",
      "1",
      "--output-dir",
      output,
      "--iteration",
      String(run.iterations),
      "--format",
      "json",
      "--format",
      "html",
    ];
    if (run.baseline) args.push("--baseline");
    await mkdir(output, { recursive: true });
    await sql`UPDATE runs SET status='running' WHERE id=${run.id}`;
    await emit(sql, job.id, "stage_changed", {
      stage: "running",
      total: slots.length * Number(run.iterations),
    });
    const child = spawn(process.env.SKILL_UP_BIN ?? "skill-up", args, {
      cwd: skillRoot,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const progress = createSkillUpProgressParser({
      slots,
      iterations: Number(run.iterations),
      onEvent: ({ type, data }) => emit(sql, job.id, type, data),
    });
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      progress.feed(text);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    let terminationTimer: NodeJS.Timeout | undefined;
    let termSent = false;
    const cancel = setInterval(async () => {
      const [fresh] =
        await sql`SELECT cancel_requested_at FROM jobs WHERE id=${job.id}`;
      if (fresh?.cancel_requested_at && !termSent) {
        termSent = true;
        child.kill("SIGTERM");
        terminationTimer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      }
    }, 750);
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    clearInterval(cancel);
    if (terminationTimer) clearTimeout(terminationTimer);
    progress.flush();
    await progress.drain();
    await sql`UPDATE runs SET status=${termSent ? "cancelling" : "finalizing"} WHERE id=${run.id}`;
    await emit(sql, job.id, "stage_changed", {
      stage: termSent ? "cancelling" : "finalizing",
    });
    let samples = 0;
    for (let iteration = 1; iteration <= run.iterations; iteration++) {
      const reportPath = join(output, `iteration-${iteration}`, "result.json");
      let report: any;
      try {
        report = JSON.parse(await readFile(reportPath, "utf8"));
      } catch {
        if (termSent) break;
        if (iteration === 1)
          throw new Error(
            `Skill-Up did not produce trustworthy result.json (exit ${exitCode}): ${stderr.slice(-2000)}`,
          );
        break;
      }
      const raw = await readFile(reportPath);
      await store.put(
        `runs/${run.id}/raw/iteration-${iteration}/result.json`,
        raw,
      );
      for (const value of report.case_results ?? []) {
        await persistSkillUpCaseResult(sql, run, value, iteration);
        samples++;
      }
    }
    const normalized =
      await sql`SELECT case_id,configuration,iteration,result,assertions,dimensions,tokens,duration_ms,error_class,detail FROM case_results WHERE run_id=${run.id} ORDER BY case_id,iteration`;
    const normalizedKey = `runs/${run.id}/normalized.json`;
    await store.put(
      normalizedKey,
      Buffer.from(
        JSON.stringify(
          {
            runId: run.id,
            skillChecksum: run.skill_checksum,
            evalChecksum: run.eval_checksum,
            results: normalized,
          },
          null,
          2,
        ),
      ),
    );
    await writeFile(join(output, "process.log"), `${stdout}\n${stderr}`);
    const reportFiles = ["process.log"];
    for (let iteration = 1; iteration <= run.iterations; iteration++) {
      for (const file of ["result.json", "report.html"]) {
        try {
          await readFile(join(output, `iteration-${iteration}`, file));
          reportFiles.push(`iteration-${iteration}/${file}`);
        } catch {
          /* optional report format */
        }
      }
    }
    const rawBundle = join(operation, "raw-report.zip");
    await createZip(output, reportFiles, rawBundle);
    const rawKey = `runs/${run.id}/raw-report.zip`;
    await store.put(rawKey, await readFile(rawBundle));
    await sql`UPDATE runs SET status=${termSent ? "cancelled" : "completed"},completed_at=now(),raw_report_key=${rawKey},normalized_key=${normalizedKey} WHERE id=${run.id}`;
    await emit(sql, job.id, "stage_changed", {
      stage: termSent ? "cancelled" : "completed",
    });
    await emit(sql, job.id, "completed", {
      resourceId: run.id,
      samples,
      exitCode,
    });
  } finally {
    await rm(operation, { recursive: true, force: true });
  }
}

export async function persistSkillUpCaseResult(
  sql: Db,
  run: Record<string, any>,
  value: Record<string, any>,
  iteration: number,
) {
  const [caseMeta] =
    await sql`SELECT * FROM eval_cases WHERE eval_version_id=${run.eval_version_id} AND case_id=${value.case_id}`;
  if (!caseMeta)
    throw new Error(`Unclassified case in report: ${value.case_id}`);
  const reportedAssertions = value.grading?.assertion_results ?? [];
  const mapped: any[] =
    caseMeta.judge_type === "script"
      ? (caseMeta.required_dimensions as string[]).map((dimension) => ({
          id: `${value.case_id}-${dimension}`,
          dimension,
          required: true,
          passed:
            value.status === "PASS" &&
            reportedAssertions.every((assertion: any) => assertion.passed),
          evidence: reportedAssertions
            .map((assertion: any) => assertion.evidence)
            .filter(Boolean)
            .join("\n"),
        }))
      : reportedAssertions.map((assertion: any) => {
          const meta = caseMeta.assertion_mapping?.[assertion.text];
          return {
            id: assertion.text,
            dimension: meta?.dimension,
            required: meta?.required !== false,
            passed: Boolean(assertion.passed),
            evidence: assertion.evidence,
          };
        });
  if (
    caseMeta.judge_type === "script" &&
    reportedAssertions.some(
      (assertion: any) =>
        !matchesCanonicalScriptJudgePath(
          String(assertion.text ?? ""),
          SCRIPT_JUDGE_BASE_PATH,
          String(value.case_id),
        ),
    )
  )
    mapped.push({
      id: "script-path-contract",
      dimension: "stability",
      required: true,
      passed: false,
      error: `Script judge path did not match ${canonicalScriptJudgePath(SCRIPT_JUDGE_BASE_PATH, String(value.case_id))}`,
    });
  if (value.status === "ERROR")
    mapped.push({
      id: "infrastructure",
      dimension: "stability",
      required: true,
      passed: false,
      error: value.error ?? "Skill-Up error",
    });
  const result = deriveResult(mapped);
  await sql`INSERT INTO case_results(run_id,case_id,configuration,iteration,result,assertions,dimensions,stable,tokens,duration_ms,error_class,detail) VALUES(${run.id},${value.case_id},${value.configuration || "skill"},${iteration},${result},${sql.json(mapped)},${sql.json(Object.fromEntries(mapped.filter((a: any) => a.dimension).map((a: any) => [a.dimension, a.passed])))},null,${sql.json({ input: value.input_tokens, output: value.output_tokens, judgeInput: value.judge_input_tokens, judgeOutput: value.judge_output_tokens })},${value.duration_ms},${value.status === "ERROR" ? "judge_or_agent" : null},${sql.json({ prompt: value.prompt, response: value.response, error: value.error })})`;
}
