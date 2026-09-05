import { serviceEndpoint } from "@skilled/core";
import {
  ArtifactStore,
  createZip,
  emit,
  deriveResult,
  extractZip,
  type Db,
  definitionsFromMapping,
  normalizeGrading,
  configuration,
  compareVerification,
  validateResultMatrix,
  NORMALIZATION_VERSION,
  sha256,
  hashFile,
  TOOLCHAIN_CAPABILITIES,
  inspectZip,
  excludedPackagePath,
} from "@skilled/core";
import { remoteExecution } from "./remote-execution.js";
import { executeBounded } from "./process.js";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
  readdir,
  lstat,
} from "node:fs/promises";
import { join, relative } from "node:path";
import {
  buildExecutionSlots,
  createSkillUpProgressParser,
} from "./run-progress.js";

export async function runEvaluation(sql: Db, job: Record<string, any>) {
  const [run] =
    await sql`SELECT r.*,sv.status skill_status FROM runs r JOIN skill_versions sv ON sv.id=r.skill_version_id WHERE r.id=${job.resource_id}`;
  if (!run) throw new Error("Run not found");
  const [jobState] =
    await sql`SELECT cancel_requested_at,status FROM jobs WHERE id=${job.id}`;
  if (jobState?.cancel_requested_at) {
    await sql`UPDATE runs SET status='cancelled',completed_at=now() WHERE id=${run.id} AND status NOT IN ('completed','failed','cancelled','interrupted')`;
    return;
  }
  if (job.adapter !== "demo") {
    await runRealEvaluation(sql, job, run);
    await finalizeVerification(sql, run.id);
    return;
  }
  await sql`UPDATE runs SET engine_versions=${sql.json(runProvenance(run, "demo"))} WHERE id=${run.id}`;
  await sql`UPDATE runs SET status='preparing',started_at=now() WHERE id=${run.id}`;
  await emit(sql, job.id, "stage_changed", { stage: "preparing" });
  const cases =
    await sql`SELECT * FROM eval_cases WHERE eval_version_id=${run.eval_version_id} AND enabled=true AND (${!Array.isArray(run.settings?.selectedCaseIds)} OR case_id=ANY(${run.settings?.selectedCaseIds ?? []}::text[])) ORDER BY case_id`;
  await sql`UPDATE runs SET status='running' WHERE id=${run.id}`;
  await emit(sql, job.id, "stage_changed", {
    stage: "running",
    total: cases.length * run.iterations * (run.baseline ? 2 : 1),
  });
  let completed = 0;
  for (let iteration = 1; iteration <= run.iterations; iteration++)
    for (const variant of run.baseline ? ["skill", "baseline"] : ["skill"])
      for (const [caseOffset, item] of cases.entries()) {
        const [fresh] =
          await sql`SELECT cancel_requested_at FROM jobs WHERE id=${job.id}`;
        if (fresh?.cancel_requested_at) {
          await sql`UPDATE runs SET status='cancelled',completed_at=now() WHERE id=${run.id}`;
          await emit(sql, job.id, "stage_changed", { stage: "cancelled" });
          await emit(sql, job.id, "completed", { cancelled: true, completed });
          return;
        }
        await emit(sql, job.id, "case_started", {
          caseId: item.case_id,
          index: caseOffset + 1,
          configuration: variant === "skill" ? "with_skill" : "without_skill",
          iteration,
          total: cases.length,
          provisional: true,
        });
        const falseGreen = String(item.case_id).startsWith("FG-");
        const scopeDrift = item.case_id === "FG-004";
        const candidateSkill =
          run.skill_status === "candidate" && variant === "skill";
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
        await sql`INSERT INTO case_results(run_id,case_id,configuration,iteration,result,assertions,dimensions,stable,tokens,duration_ms,detail) VALUES(${run.id},${item.case_id},${variant},${iteration},${result},${sql.json(assertions)},${sql.json(dimensions)},true,${sql.json({ input: 1200, output: 240 })},${900 + completed * 41},${sql.json({ prompt: item.source?.prompt, response: falseGreen ? "Approved without sufficient grounded evidence." : "Completed with cited evidence.", evidence: item.evidence_provenance })})`;
        completed++;
        await emit(sql, job.id, "case_completed", {
          caseId: item.case_id,
          index: caseOffset + 1,
          configuration: variant === "skill" ? "with_skill" : "without_skill",
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
  validateResultMatrix(
    normalized,
    cases.map((c) => String(c.case_id)),
    Boolean(run.baseline),
    Number(run.iterations),
  );
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
          adapter: job.adapter,
          normalizationVersion: NORMALIZATION_VERSION,
          settings: run.settings,
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
      {
        schema_version: "skilled-v1",
        provenance: runProvenance(run, "demo"),
        case_results: normalized,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(reportDir, "report.html"),
    `<!doctype html><meta charset="utf-8"><title>SkillEd run ${run.id}</title><h1>SkillEd demo evidence report</h1><p>Deterministic demo evidence; no model execution.</p><pre>${escapeHtml(JSON.stringify(normalized, null, 2))}</pre>`,
  );
  const rawBundle = join(reportDir, "raw-report.zip");
  await createZip(reportDir, ["result.json", "report.html"], rawBundle);
  const rawKey = `runs/${run.id}/raw-report.zip`;
  await store.putFile(rawKey, rawBundle);
  await rm(reportDir, { recursive: true, force: true });
  await sql`UPDATE runs SET status='completed',completed_at=now(),raw_report_key=${rawKey},normalized_key=${normalizedKey} WHERE id=${run.id}`;
  await finalizeVerification(sql, run.id);
  await emit(sql, job.id, "stage_changed", { stage: "completed" });
  await emit(sql, job.id, "completed", { resourceId: run.id, completed });
}

export async function finalizeVerification(sql: Db, runId: string) {
  const proposals =
    await sql`SELECT * FROM update_proposals WHERE status='verifying' AND (current_verification_run_id=${runId} OR candidate_verification_run_id=${runId})`;
  for (const proposal of proposals) {
    const [current] =
      await sql`SELECT * FROM runs WHERE id=${proposal.current_verification_run_id}`;
    const [candidate] =
      await sql`SELECT * FROM runs WHERE id=${proposal.candidate_verification_run_id}`;
    if (
      [current?.status, candidate?.status].some((status) =>
        ["failed", "cancelled", "interrupted"].includes(status),
      )
    ) {
      await sql`UPDATE update_proposals SET status='failed',comparison=${sql.json({ blocked: true, reasons: ["Verification execution did not complete"] })},updated_at=now() WHERE id=${proposal.id} AND status='verifying'`;
      continue;
    }
    if (current?.status !== "completed" || candidate?.status !== "completed")
      continue;
    const before =
      await sql`SELECT * FROM case_results WHERE run_id=${current.id}`;
    const after =
      await sql`SELECT * FROM case_results WHERE run_id=${candidate.id}`;
    const expected =
      await sql`SELECT case_id FROM eval_cases WHERE eval_version_id=${proposal.eval_version_id} AND enabled=true ORDER BY case_id`;
    const comparison = compareVerification(
      before,
      after,
      expected.map((r) => String(r.case_id)),
      Number(candidate.iterations),
      Boolean(candidate.baseline),
    );
    if (
      current.eval_version_id !== candidate.eval_version_id ||
      current.iterations !== candidate.iterations ||
      current.baseline !== candidate.baseline ||
      current.model !== candidate.model
    ) {
      comparison.blocked = true;
      comparison.reasons.push("Verification settings do not match");
    }
    await sql`UPDATE update_proposals SET status=${comparison.blocked ? "failed" : "verified"},comparison=${sql.json(comparison)},updated_at=now() WHERE id=${proposal.id} AND status='verifying'`;
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function runProvenance(
  run: Record<string, any>,
  adapter: string,
  inputs?: Record<string, any>,
) {
  return {
    schemaVersion: "skilled-run-provenance-v1",
    adapter,
    model: run.model,
    normalizationVersion: NORMALIZATION_VERSION,
    imageRevision:
      process.env.SKILLED_IMAGE_REVISION ??
      process.env.RENDER_GIT_COMMIT ??
      "local-unpublished",
    versions: {
      codex: adapter === "real" ? "0.149.0-alpha.4.1" : null,
      skillUp: "skilled-v2",
      node: process.version,
    },
    permissionPolicy:
      adapter === "real"
        ? "skilled-restricted-v1; acceptance evidence required"
        : "demo-no-model-execution",
    toolchain: TOOLCHAIN_CAPABILITIES,
    hashes: {
      originalSkill: run.skill_checksum,
      installableSkill: inputs?.installable_checksum ?? null,
      approvedEval: run.eval_checksum,
    },
    settings: {
      ...run.settings,
      iterations: run.iterations,
      baseline: run.baseline,
    },
  };
}

async function runRealEvaluation(
  sql: Db,
  job: Record<string, any>,
  run: Record<string, any>,
) {
  await sql`UPDATE runs SET status='preparing',started_at=COALESCE(started_at,now()) WHERE id=${run.id}`;
  await emit(sql, job.id, "stage_changed", { stage: "preparing" });
  const [inputs] =
    await sql`SELECT sv.installable_key,sv.installable_checksum,sv.selected_root,ev.bundle_key,ev.checksum eval_checksum FROM skill_versions sv JOIN eval_versions ev ON ev.id=${run.eval_version_id} WHERE sv.id=${run.skill_version_id}`;
  await sql`UPDATE runs SET engine_versions=${sql.json(runProvenance(run, "real", inputs))} WHERE id=${run.id}`;
  if (!inputs?.installable_key || !inputs?.bundle_key)
    throw new Error("Pinned Skill or eval artifact is missing");
  const cases =
    await sql`SELECT case_id FROM eval_cases WHERE eval_version_id=${run.eval_version_id} AND enabled=true AND (${!Array.isArray(run.settings?.selectedCaseIds)} OR case_id=ANY(${run.settings?.selectedCaseIds ?? []}::text[])) ORDER BY case_id`;
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
    const installed = await readFile(
      await store.materialize(inputs.installable_key),
    );
    const evaluation = await readFile(
      await store.materialize(inputs.bundle_key),
    );
    if (
      !inputs.installable_checksum ||
      sha256(installed) !== inputs.installable_checksum ||
      sha256(evaluation) !== run.eval_checksum
    )
      throw new Error(
        "Execution input checksum is missing or changed; create a verified version",
      );
    const inspected = await inspectZip(
      await store.materialize(inputs.installable_key),
    );
    if (
      inspected.entries.some(
        (entry) => !entry.directory && excludedPackagePath(entry.path),
      )
    )
      throw new Error(
        "Legacy package includes orchestration control files; upload a new normalized version before execution",
      );
    await extractZip(
      await store.materialize(inputs.installable_key),
      operation,
    );
    await extractZip(await store.materialize(inputs.bundle_key), skillRoot, {
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
    for (const item of cases)
      args.push("--include-case-name", String(item.case_id));
    await mkdir(output, { recursive: true });
    await sql`UPDATE runs SET status='running' WHERE id=${run.id}`;
    await emit(sql, job.id, "stage_changed", {
      stage: "running",
      total: slots.length * Number(run.iterations),
    });
    const progress = createSkillUpProgressParser({
      slots,
      iterations: Number(run.iterations),
      onEvent: ({ type, data }) => emit(sql, job.id, type, data),
    });
    const outcome = serviceEndpoint("EXECUTOR")
      ? await remoteExecution(
          operation,
          {
            kind: "skillup",
            evalPath: relative(operation, join(skillRoot, "evals/eval.yaml")),
            model: run.model,
            iterations: Number(run.iterations),
            baseline: Boolean(run.baseline),
            selectedCaseIds: cases.map((c) => String(c.case_id)),
          },
          (text) => progress.feed(text),
        )
      : await executeBounded(process.env.SKILL_UP_BIN ?? "skill-up", args, {
          cwd: operation,
          onStdout: (text) => progress.feed(text),
          cancelled: async () => {
            const [fresh] =
              await sql`SELECT cancel_requested_at,status,lease_token FROM jobs WHERE id=${job.id}`;
            return Boolean(
              fresh?.cancel_requested_at ||
                fresh?.status !== "running" ||
                Number(fresh?.lease_token) !== Number(job.lease_token),
            );
          },
        });
    const { stdout, stderr, exitCode } = outcome;
    const termSent = outcome.cancelled;
    progress.flush();
    await progress.drain();
    await sql`UPDATE runs SET status=${termSent ? "cancelling" : "finalizing"} WHERE id=${run.id}`;
    await emit(sql, job.id, "stage_changed", {
      stage: termSent ? "cancelling" : "finalizing",
    });
    let samples = 0;
    const ingestionErrors: string[] = [];
    for (let iteration = 1; iteration <= run.iterations; iteration++) {
      const reportPath = join(output, `iteration-${iteration}`, "result.json");
      let report: any;
      try {
        report = JSON.parse(await readFile(reportPath, "utf8"));
      } catch {
        ingestionErrors.push(
          `Missing or malformed iteration ${iteration} report (exit ${exitCode})`,
        );
        continue;
      }
      const raw = await readFile(reportPath);
      await store.put(
        `runs/${run.id}/raw/iteration-${iteration}/result.json`,
        raw,
      );
      if (!Array.isArray(report.case_results)) {
        ingestionErrors.push(`Iteration ${iteration} has no results array`);
        continue;
      }
      for (const value of report.case_results) {
        try {
          await persistSkillUpCaseResult(sql, run, value, iteration);
          samples++;
        } catch (error) {
          ingestionErrors.push(String(error));
        }
      }
    }
    const normalized =
      await sql`SELECT case_id,configuration,iteration,result,assertions,dimensions,tokens,duration_ms,error_class,detail FROM case_results WHERE run_id=${run.id} ORDER BY case_id,iteration`;
    const normalizedKey = `runs/${run.id}/normalized.json`;
    await writeFile(join(output, "process.log"), `${stdout}\n${stderr}`);
    const reportFiles: string[] = [];
    let outputBytes = 0;
    async function collect(directory: string, prefix = "") {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink() || /(^|\/)auth\.json$/i.test(name)) continue;
        if (entry.isDirectory())
          await collect(join(directory, entry.name), name);
        else if (entry.isFile()) {
          const info = await lstat(join(directory, entry.name));
          outputBytes += info.size;
          if (outputBytes > 250 * 1024 * 1024) {
            ingestionErrors.push("Collected artifacts exceed 250 MiB");
            return;
          }
          reportFiles.push(name);
        }
      }
    }
    await collect(output);
    const artifactManifest: Array<{
      key: string;
      checksum: string;
      size: number;
      mediaType: string;
    }> = [];
    for (const name of reportFiles) {
      const path = join(output, name),
        key = `runs/${run.id}/evidence/${name}`;
      const artifact = await store.putFile(key, path);
      artifactManifest.push({
        ...artifact,
        mediaType: /\.(json|csv|txt|md)$/i.test(name)
          ? "text/plain"
          : "application/octet-stream",
      });
    }
    await store.put(
      `runs/${run.id}/artifacts.json`,
      Buffer.from(
        JSON.stringify({
          schemaVersion: "skilled-artifacts-v1",
          entries: artifactManifest,
        }),
      ),
    );
    for (const row of normalized) {
      const variant =
        configuration(row.configuration) === "skill"
          ? "with_skill"
          : "without_skill";
      const prefix = `runs/${run.id}/evidence/iteration-${row.iteration}/${row.case_id}/${variant}/`;
      const references = artifactManifest.filter((entry) =>
        entry.key.startsWith(prefix),
      );
      const transcript = references.find((entry) =>
        /transcript\.(json|md)$/.test(entry.key),
      );
      await sql`UPDATE case_results SET artifacts=${sql.json(references)},transcript_key=${transcript?.key ?? null} WHERE run_id=${run.id} AND case_id=${row.case_id} AND configuration=${row.configuration} AND iteration=${row.iteration}`;
    }
    try {
      validateResultMatrix(
        normalized,
        cases.map((c) => String(c.case_id)),
        Boolean(run.baseline),
        Number(run.iterations),
      );
    } catch (error) {
      ingestionErrors.push(String(error));
    }
    if (outcome.timedOut || outcome.outputLimited)
      ingestionErrors.push("Execution resource budget exceeded");
    if (![0, 1].includes(exitCode ?? -1))
      ingestionErrors.push(`Unexpected Skill-Up exit ${exitCode}`);
    const finalRows =
      await sql`SELECT case_id,configuration,iteration,result,assertions,dimensions,tokens,duration_ms,error_class,detail,artifacts,transcript_key FROM case_results WHERE run_id=${run.id} ORDER BY case_id,configuration,iteration`;
    const exportManifest = {
      runId: run.id,
      provenance: runProvenance(run, "real", inputs),
      execution: {
        exitCode,
        cancelled: termSent,
        timedOut: outcome.timedOut,
        outputLimited: outcome.outputLimited,
        ingestionErrors,
      },
      results: finalRows,
      artifacts: artifactManifest,
    };
    const exported = JSON.stringify(exportManifest, null, 2);
    await store.put(normalizedKey, Buffer.from(exported));
    await writeFile(join(output, "skilled-manifest.json"), exported);
    reportFiles.push("skilled-manifest.json");
    const rawBundle = join(operation, "raw-report.zip");
    await createZip(output, reportFiles, rawBundle);
    const rawKey = `runs/${run.id}/raw-report.zip`;
    await store.putFile(rawKey, rawBundle);
    await sql`UPDATE runs SET status=${termSent ? "cancelled" : ingestionErrors.length ? "failed" : "completed"},completed_at=now(),raw_report_key=${rawKey},normalized_key=${normalizedKey} WHERE id=${run.id}`;
    await emit(sql, job.id, "stage_changed", {
      stage: termSent
        ? "cancelled"
        : ingestionErrors.length
          ? "failed"
          : "completed",
    });
    await emit(
      sql,
      job.id,
      termSent ? "cancelled" : ingestionErrors.length ? "failed" : "completed",
      {
        resourceId: run.id,
        samples,
        exitCode,
        ingestionErrors,
      },
    );
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
  const graded = normalizeGrading(
    value,
    definitionsFromMapping(caseMeta.assertion_mapping),
    caseMeta.judge_type,
    caseMeta.required_dimensions,
  );
  const mapped = graded.assertions;
  const result = graded.result;
  await sql`INSERT INTO case_results(run_id,case_id,configuration,iteration,result,assertions,dimensions,stable,tokens,duration_ms,error_class,detail) VALUES(${run.id},${value.case_id},${configuration(value.configuration ?? "skill")},${iteration},${result},${sql.json(mapped)},${sql.json(graded.dimensions)},null,${sql.json({ input: value.input_tokens, output: value.output_tokens, judgeInput: value.judge_input_tokens, judgeOutput: value.judge_output_tokens })},${value.duration_ms},${graded.errorClass},${sql.json({ prompt: value.prompt, response: value.response, error: graded.detail || value.error, normalizationVersion: NORMALIZATION_VERSION })})`;
}
