import { remapCaseMaterials } from "@skilled/core";
import {
  ArtifactStore,
  assessPackage,
  materialVisibility,
  validateInitialVerification,
  validateCoverage,
  CoveragePlanSchema,
  profileHash,
  TOOLCHAIN_CAPABILITIES,
  unsupportedRequirements,
  AuthoringRevisionSchema,
  GeneratedEvalCaseSchema,
  ConversationMessageSchema,
  EvalAnswersSchema,
  RunLaunchSchema,
  ProposalDecisionSchema,
  db,
  enqueue,
  evidenceLevel,
  inspectZip,
  extractZip,
  createZip,
  problem,
  readZipEntry,
  sha256,
  type Db,
  inTransaction,
  recordDecision,
  MaterialKindSchema,
  parseSkillMetadata,
  excludedPackagePath,
  applyFileChanges,
  packageFiles,
  type FileChange,
} from "@skilled/core";
import { packageAssessment } from "../../../../lib/data";
import { multipart } from "../../../../lib/multipart";
import { mutation } from "../../../../lib/mutation";
import { executionAvailability } from "../../../../lib/execution-availability";

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

import { reconstructRunStatus } from "../../../../lib/run-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const sql = db();
const ready = Promise.resolve();
const store = new ArtifactStore();
const json = (value: unknown, status = 200) => Response.json(value, { status });
const fail = (
  code: string,
  title: string,
  detail: string,
  status = 400,
  retryable = false,
  field?: string,
) => json(problem(code, title, detail, retryable, field), status);
type Context = { params: Promise<{ path: string[] }> };

const parseFrontmatter = parseSkillMetadata;
const excluded = excludedPackagePath;

/** A normalised URL can leave a non-id segment where an id belongs; that is a
 * miss, not a server error. */
const isId = (value: string | undefined) =>
  !!value &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function GET(request: Request, context: Context) {
  await ready;
  const { path } = await context.params;
  try {
    if (
      path[0] === "skill" &&
      path[1] === "versions" &&
      isId(path[2]) &&
      path[3] === "assessment"
    ) {
      const [version] =
        await sql`SELECT * FROM skill_versions WHERE id=${path[2]!}`;
      return version
        ? json(await packageAssessment(version))
        : fail("NOT_FOUND", "Version not found", "", 404);
    }
    if (path[0] === "evals" && isId(path[1]) && path[2] === "profile") {
      const [evaluation] =
        await sql`SELECT * FROM eval_versions WHERE id=${path[1]!}`;
      return evaluation
        ? json({
            schemaVersion: "skilled-profile-v1",
            revision: evaluation.revision,
            task: evaluation.task_understanding,
            outputs: evaluation.task_understanding?.outputs ?? [],
            areas: evaluation.coverage_plan?.areas ?? [],
            approved: evaluation.status === "approved",
            hash: profileHash(
              evaluation.coverage_plan,
              evaluation.task_understanding,
            ),
          })
        : fail("NOT_FOUND", "Evaluation not found", "", 404);
    }
    if (path[0] === "capabilities") return json(TOOLCHAIN_CAPABILITIES);
    if (path.length === 1 && path[0] === "execution-readiness") {
      const [worker] =
        await sql`SELECT last_seen_at,readiness FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1`;
      return json(executionAvailability(worker as any));
    }
    if (path[0] === "health") {
      const [dbNow] = await sql`SELECT now()`,
        [worker] =
          await sql`SELECT * FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1`;
      const age = worker
        ? Date.now() - new Date(worker.last_seen_at).getTime()
        : Infinity;
      return json({
        status: dbNow && age < 30_000 ? "ready" : "degraded",
        execution:
          age < 30_000
            ? (worker?.readiness?.execution ?? "blocked")
            : "blocked",
        database: "ready",
        worker: worker
          ? {
              status: age < 30_000 ? "ready" : "stale",
              lastSeenAt: worker.last_seen_at,
              versions: worker.versions,
              readiness: worker.readiness,
            }
          : { status: "missing" },
        artifacts: (await store.exists(".health"))
          ? "ready"
          : "writable-on-demand",
      });
    }
    if (path[0] === "skill" && path[1] === "current") {
      const skillId = new URL(request.url).searchParams.get("skill");
      const [skill] = skillId
        ? await sql`SELECT s.*,row_to_json(v.*) version FROM skills s LEFT JOIN skill_versions v ON v.id=COALESCE(s.active_version_id,(SELECT latest.id FROM skill_versions latest WHERE latest.skill_id=s.id ORDER BY latest.version DESC LIMIT 1)) WHERE s.id=${skillId}`
        : await sql`SELECT s.*,row_to_json(v.*) version FROM skills s LEFT JOIN skill_versions v ON v.id=COALESCE(s.active_version_id,(SELECT latest.id FROM skill_versions latest WHERE latest.skill_id=s.id ORDER BY latest.version DESC LIMIT 1)) ORDER BY s.updated_at DESC LIMIT 1`;
      if (!skill) return json(null);
      return json(skill);
    }
    if (path[0] === "skills" && path.length === 1) {
      const skills =
        await sql`SELECT s.*,v.version active_version,v.description FROM skills s LEFT JOIN skill_versions v ON v.id=s.active_version_id ORDER BY s.updated_at DESC,s.name`;
      return json(skills);
    }
    // File reads come before the version/eval lookups below, which match on a
    // shorter prefix and would otherwise swallow these paths.
    if (
      path[0] === "skill" &&
      path[1] === "versions" &&
      path[2] &&
      path[3] === "files"
    ) {
      const entryPath = path.slice(4).join("/");
      if (!entryPath)
        return fail("BAD_REQUEST", "No file named", "Name a file to read.");
      if (!isId(path[2]))
        return fail("NOT_FOUND", "Version not found", "", 404);
      const [version] =
        await sql`SELECT installable_key,original_key,selected_root FROM skill_versions WHERE id=${path[2]}`;
      if (!version) return fail("NOT_FOUND", "Version not found", "", 404);
      const key = version.installable_key ?? version.original_key;
      // Manifest paths are root-relative; the archive keeps the root directory.
      const inArchive = version.selected_root
        ? `${version.selected_root}/${entryPath}`
        : entryPath;
      try {
        return json(
          await readZipEntry(await store.materialize(key), inArchive),
        );
      } catch (cause) {
        return fail(
          "NOT_FOUND",
          "File not readable",
          cause instanceof Error
            ? cause.message
            : "The file could not be read.",
          404,
        );
      }
    }
    if (path[0] === "evals" && path[1] && path[2] === "files") {
      const entryPath = path.slice(3).join("/");
      if (!entryPath)
        return fail("BAD_REQUEST", "No file named", "Name a file to read.");
      if (!isId(path[1])) return fail("NOT_FOUND", "Eval not found", "", 404);
      const [evaluation] =
        await sql`SELECT bundle_key FROM eval_versions WHERE id=${path[1]}`;
      if (!evaluation?.bundle_key)
        return fail(
          "NOT_READY",
          "No eval bundle yet",
          "The eval suite has not been generated, so it has no files.",
          409,
        );
      try {
        return json(
          await readZipEntry(
            await store.materialize(evaluation.bundle_key),
            entryPath,
          ),
        );
      } catch (cause) {
        return fail(
          "NOT_FOUND",
          "File not readable",
          cause instanceof Error
            ? cause.message
            : "The file could not be read.",
          404,
        );
      }
    }
    if (path[0] === "skill" && path[1] === "versions" && path[2]) {
      const [version] =
        await sql`SELECT * FROM skill_versions WHERE id=${path[2]}`;
      return version
        ? json(version)
        : fail(
            "NOT_FOUND",
            "Version not found",
            "The Skill version does not exist.",
            404,
          );
    }
    if (path[0] === "skill" && path[1] === "download" && path[2]) {
      const [version] =
        await sql`SELECT * FROM skill_versions WHERE id=${path[2]}`;
      if (!version) return fail("NOT_FOUND", "Version not found", "", 404);
      const original =
        new URL(request.url).searchParams.get("kind") === "original";
      const key = original ? version.original_key : version.installable_key;
      const bytes = await readFile(await store.materialize(key));
      return new Response(bytes, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${String(version.name).replace(/[^A-Za-z0-9._-]/g, "_")}-v${version.version}.zip"`,
        },
      });
    }
    if (path[0] === "evals" && path[1] && path[2] === "materials" && path[3]) {
      const [file] =
        await sql`SELECT * FROM eval_files WHERE id=${path[3]} AND eval_version_id=${path[1]}`;
      if (!file?.artifact_key)
        return fail("NOT_FOUND", "Material not found", "", 404);
      const safeName = String(file.filename).replace(/[^A-Za-z0-9._-]/g, "_");
      const preview = /\.(txt|csv|md|json|yaml|yml)$/i.test(safeName);
      return new Response(
        Readable.toWeb(
          createReadStream(await store.materialize(file.artifact_key)),
        ) as ReadableStream,
        {
          headers: {
            "content-type": preview
              ? "text/plain; charset=utf-8"
              : "application/octet-stream",
            "x-content-type-options": "nosniff",
            "content-disposition": `${preview ? "inline" : "attachment"}; filename="${safeName}"`,
          },
        },
      );
    }
    if (path[0] === "evals" && path[1]) {
      let id = path[1];
      if (id === "current") {
        const skillId = new URL(request.url).searchParams.get("skill");
        const [row] = skillId
          ? await sql`SELECT ev.id FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id WHERE sv.skill_id=${skillId} ORDER BY ev.created_at DESC LIMIT 1`
          : await sql`SELECT id FROM eval_versions ORDER BY created_at DESC LIMIT 1`;
        if (!row) return json(null);
        id = row.id;
      }
      const [evaluation] =
        await sql`SELECT * FROM eval_versions WHERE id=${id}`;
      if (!evaluation) return fail("NOT_FOUND", "Eval not found", "", 404);
      const cases =
        await sql`SELECT * FROM eval_cases WHERE eval_version_id=${id} ORDER BY case_id`;
      const messages =
        await sql`SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.resource_id=${id} ORDER BY m.created_at`;
      return json({ ...evaluation, cases, messages });
    }
    if (path[0] === "runs" && path[1] && path[2] === "status") {
      const [run] =
        await sql`SELECT id,status,baseline,iterations,settings,job_id,created_at,started_at,completed_at,eval_version_id FROM runs WHERE id=${path[1]}`;
      if (!run) return fail("NOT_FOUND", "Run not found", "", 404);
      const cases =
        await sql`SELECT case_id FROM eval_cases WHERE eval_version_id=${run.eval_version_id} AND enabled=true ORDER BY case_id`;
      const events = run.job_id
        ? await sql`SELECT sequence,type,data,occurred_at FROM job_events WHERE job_id=${run.job_id} AND type IN ('stage_changed','case_started','case_completed') ORDER BY sequence`
        : [];
      const results =
        await sql`SELECT case_id,configuration,iteration,result FROM case_results WHERE run_id=${run.id} ORDER BY case_id,configuration,iteration`;
      return json(
        reconstructRunStatus(
          run as any,
          cases
            .map((item) => String(item.case_id))
            .filter(
              (id) =>
                !Array.isArray(run.settings?.selectedCaseIds) ||
                run.settings.selectedCaseIds.includes(id),
            ),
          events as any,
          results as any,
        ),
      );
    }
    if (path[0] === "runs" && path[1] && path[2] === "artifact") {
      const key = new URL(request.url).searchParams.get("key");
      if (!key)
        return fail("MISSING_ARTIFACT", "Artifact key is required", "", 400);
      const entries =
        await sql`SELECT artifacts FROM case_results WHERE run_id=${path[1]}`;
      const artifact = entries
        .flatMap((row) => row.artifacts ?? [])
        .find((item: any) => item.key === key);
      if (!artifact)
        return fail(
          "NOT_FOUND",
          "Artifact is not referenced by this run",
          "",
          404,
        );
      const filename = basename(key).replace(/[^A-Za-z0-9._-]/g, "_");
      if (new URL(request.url).searchParams.get("preview") === "1") {
        const target = await store.materialize(key);
        if ((await stat(target)).size > 1_000_000)
          return fail(
            "PREVIEW_LIMIT",
            "Download required",
            "This file exceeds the 1 MB preview limit. Download it to inspect all evidence.",
            413,
          );
        const bytes = await readFile(target);
        if (artifact.checksum && sha256(bytes) !== artifact.checksum)
          return fail(
            "ARTIFACT_INTEGRITY",
            "Artifact integrity check failed",
            "The stored output differs from the run manifest.",
            409,
          );
        if (bytes.subarray(0, 8192).includes(0) || /\.xlsx$/i.test(key))
          return fail(
            "BINARY_PREVIEW",
            "Download required",
            "Download this binary output. Judged workbook cells and protected-field comparisons appear under assertion evidence.",
            415,
          );
        let text = bytes.toString("utf8");
        if (/\.json$/i.test(key)) {
          try {
            text = JSON.stringify(JSON.parse(text), null, 2);
          } catch {}
        }
        return json({ filename, text });
      }

      return new Response(
        Readable.toWeb(
          createReadStream(await store.materialize(key)),
        ) as ReadableStream,
        {
          headers: {
            "content-type": artifact.mediaType,
            "x-content-type-options": "nosniff",
            "content-disposition": `attachment; filename="${filename}"`,
          },
        },
      );
    }
    if (path[0] === "runs" && path[1] && path[2] === "download") {
      const [run] =
        await sql`SELECT raw_report_key FROM runs WHERE id=${path[1]}`;
      if (!run?.raw_report_key)
        return fail(
          "NOT_READY",
          "Report is not ready",
          "The run has no completed raw report bundle.",
          409,
        );
      const bytes = await readFile(await store.materialize(run.raw_report_key));
      return new Response(bytes, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="skilled-run-${path[1]}.zip"`,
        },
      });
    }
    if (path[0] === "runs" && path[1]) {
      let id = path[1];
      if (id === "current") {
        const skillId = new URL(request.url).searchParams.get("skill");
        const [row] = skillId
          ? await sql`SELECT r.id FROM runs r JOIN skill_versions sv ON sv.id=r.skill_version_id WHERE sv.skill_id=${skillId} ORDER BY r.created_at DESC LIMIT 1`
          : await sql`SELECT id FROM runs ORDER BY created_at DESC LIMIT 1`;
        if (!row) return json(null);
        id = row.id;
      }
      const [run] =
        await sql`SELECT r.*,sv.version skill_version,ev.version eval_version FROM runs r JOIN skill_versions sv ON sv.id=r.skill_version_id JOIN eval_versions ev ON ev.id=r.eval_version_id WHERE r.id=${id}`;
      if (!run) return fail("NOT_FOUND", "Run not found", "", 404);
      const results =
        await sql`SELECT cr.*,ec.title,ec.coverage_group FROM case_results cr LEFT JOIN eval_cases ec ON ec.eval_version_id=${run.eval_version_id} AND ec.case_id=cr.case_id WHERE cr.run_id=${id} ORDER BY CASE cr.result WHEN 'ERROR' THEN 0 WHEN 'FAIL' THEN 1 WHEN 'PARTIAL' THEN 2 ELSE 3 END,cr.case_id,cr.iteration`;
      return json({ ...run, results });
    }
    if (path[0] === "improve" && path[1]) {
      let id = path[1];
      if (id === "current") {
        const skillId = new URL(request.url).searchParams.get("skill");
        const [row] = skillId
          ? await sql`SELECT p.id FROM update_proposals p JOIN skill_versions sv ON sv.id=p.base_version_id WHERE sv.skill_id=${skillId} ORDER BY p.created_at DESC LIMIT 1`
          : await sql`SELECT id FROM update_proposals ORDER BY created_at DESC LIMIT 1`;
        if (!row) return json(null);
        id = row.id;
      }
      const [p] =
        await sql`SELECT p.*,sv.version base_version FROM update_proposals p JOIN skill_versions sv ON sv.id=p.base_version_id WHERE p.id=${id}`;
      if (!p) return fail("NOT_FOUND", "Proposal not found", "", 404);
      let skillPatch = "";
      if (p.skill_patch_key)
        skillPatch = (
          await readFile(await store.materialize(p.skill_patch_key))
        ).toString("utf8");
      return json({ ...p, skillPatch });
    }
    if (path[0] === "jobs" && path[1] && path[2] !== "events") {
      const [job] = await sql`SELECT * FROM jobs WHERE id=${path[1]}`;
      return job ? json(job) : fail("NOT_FOUND", "Job not found", "", 404);
    }
    if (path[0] === "jobs" && path[1] && path[2] === "events") {
      const jobId = path[1],
        last = Number(
          request.headers.get("last-event-id") ??
            new URL(request.url).searchParams.get("after") ??
            0,
        );
      if (!Number.isSafeInteger(last) || last < 0)
        return fail("INVALID_CURSOR", "Invalid event cursor", "", 400);
      const encoder = new TextEncoder();
      let closed = false;
      const stream = new ReadableStream({
        async start(controller) {
          let cursor = last;
          const close = () => {
            if (!closed) {
              closed = true;
              controller.close();
            }
          };
          request.signal.addEventListener("abort", close, { once: true });
          try {
            for (let cycles = 0; cycles < 300 && !closed; cycles++) {
              // Disconnect slow readers; EventSource reconnects from its durable cursor.
              if ((controller.desiredSize ?? 0) < -250) break;
              const events =
                await sql`SELECT sequence,type,data,occurred_at FROM job_events WHERE job_id=${jobId} AND sequence>${cursor} ORDER BY sequence LIMIT 250`;
              for (const event of events) {
                if (closed) return;
                cursor = Number(event.sequence);
                controller.enqueue(
                  encoder.encode(
                    `id: ${cursor}\ndata: ${JSON.stringify({ id: cursor, jobId, type: event.type, occurredAt: new Date(event.occurred_at).toISOString(), data: event.data })}\n\n`,
                  ),
                );
                if (
                  ["completed", "failed", "cancelled", "interrupted"].includes(
                    event.type,
                  )
                )
                  return;
              }
              await new Promise((r) => setTimeout(r, 1000));
            }
          } catch {
            /* A reconnect replays committed events after a transient database failure. */
          } finally {
            request.signal.removeEventListener("abort", close);
            close();
          }
        },
        cancel() {
          closed = true;
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }
    return fail(
      "NOT_FOUND",
      "Endpoint not found",
      `Unknown API path: ${path.join("/")}`,
      404,
    );
  } catch (cause) {
    return fail(
      "INTERNAL",
      "Request failed",
      cause instanceof Error ? cause.message : String(cause),
      500,
      true,
    );
  }
}

export async function POST(request: Request, context: Context) {
  return mutation(request, (tx) => post(request, context, tx));
}
async function post(request: Request, context: Context, sql: Db) {
  await ready;
  const { path } = await context.params;
  try {
    if (
      path[0] === "skill" &&
      path[1] === "versions" &&
      isId(path[2]) &&
      path[3] === "activate-initial"
    ) {
      const input = await request.json();
      if (!isId(input.runId) || input.expectedActiveVersionId !== null)
        return fail(
          "INVALID_DECISION",
          "Initial activation requires an unactivated package",
          "Choose the completed three-trial run and review the current version.",
          409,
        );
      const [version] =
        await sql`SELECT sv.*,s.active_version_id FROM skill_versions sv JOIN skills s ON s.id=sv.skill_id WHERE sv.id=${path[2]!} FOR UPDATE OF s`;
      if (!version) return fail("NOT_FOUND", "Version not found", "", 404);
      if (version.active_version_id === version.id)
        return json({ resourceId: version.id, status: "active" });
      if (version.active_version_id)
        return fail(
          "STALE_ACTIVE_VERSION",
          "The active version changed",
          "Use candidate comparison before replacing an active version.",
          409,
        );
      const [run] =
        await sql`SELECT r.*,ev.status eval_status,ev.checksum approved_checksum FROM runs r JOIN eval_versions ev ON ev.id=r.eval_version_id WHERE r.id=${input.runId} AND r.skill_version_id=${version.id}`;
      if (
        !run ||
        run.eval_status !== "approved" ||
        run.skill_checksum !== version.checksum ||
        run.eval_checksum !== run.approved_checksum
      )
        return fail(
          "UNVERIFIED_VERSION",
          "Verification does not match this package",
          "Run the exact package against an approved test plan.",
          409,
        );
      const cases =
        await sql`SELECT * FROM eval_cases WHERE eval_version_id=${run.eval_version_id} AND enabled=true ORDER BY case_id`;
      const results =
        await sql`SELECT * FROM case_results WHERE run_id=${run.id}`;
      try {
        validateInitialVerification(
          run,
          cases,
          results,
          process.env.SKILLED_ADAPTER_MODE === "fake" ? "demo" : "real",
        );
      } catch (error) {
        return fail(
          "VERIFICATION_INCOMPLETE",
          "Initial verification is incomplete",
          error instanceof Error ? error.message : String(error),
          409,
        );
      }
      const assessment = await packageAssessment(version);
      if (!assessment.valid || assessment.runtime === "unsupported")
        return fail(
          "PACKAGE_BLOCKED",
          "Package needs attention",
          "Resolve package findings before activation.",
          409,
        );
      await sql`UPDATE skills SET active_version_id=${version.id},updated_at=now() WHERE id=${version.skill_id} AND active_version_id IS NULL`;
      await recordDecision(
        sql,
        request.headers.get("x-skilled-user-id"),
        version.id,
        "initial_activation",
        {
          runId: run.id,
          packageHash: version.checksum,
          evalHash: run.eval_checksum,
          comparison: "initial verification; no measured improvement",
        },
      );
      return json({ resourceId: version.id, status: "active" });
    }
    const modelOperation =
      (path[0] === "evals" &&
        ["author", "answers", "messages", "approve-plan", "retry"].includes(
          path[2] ?? "",
        )) ||
      (path[0] === "runs" && path[1] === "launch") ||
      (path[0] === "updates" &&
        (path[1] === "generate" ||
          ["verify", "messages"].includes(path[2] ?? "")));
    if (modelOperation && process.env.SKILLED_ADAPTER_MODE !== "fake") {
      const [worker] =
        await sql`SELECT last_seen_at,readiness FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1`;
      const availability = executionAvailability(worker as any);
      if (!availability.available)
        return fail(
          "EXECUTION_UNAVAILABLE",
          "Execution unavailable",
          availability.detail,
          503,
          false,
        );
    }

    if (
      path[0] === "updates" &&
      path[1] &&
      path[1] !== "generate" &&
      request.headers.get("content-type")?.includes("application/json")
    ) {
      const input = await request.clone().json();
      if (input.expectedRevision !== undefined) {
        const [proposal] =
          await sql`SELECT revision FROM update_proposals WHERE id=${path[1]} FOR UPDATE`;
        if (
          !proposal ||
          Number(proposal.revision) !== Number(input.expectedRevision)
        )
          return fail(
            "STALE_REVISION",
            "Proposal changed",
            "Refresh and review the latest proposal",
            409,
          );
      }
    }
    if (
      path[0] === "evals" &&
      path[1] &&
      request.headers.get("content-type")?.includes("application/json")
    ) {
      const input = await request.clone().json();
      if (input.expectedRevision !== undefined) {
        const [revision] =
          await sql`SELECT revision FROM eval_versions WHERE id=${path[1]} FOR UPDATE`;
        if (
          !revision ||
          Number(input.expectedRevision) !== Number(revision.revision)
        )
          return fail(
            "STALE_REVISION",
            "Evaluation changed",
            "Refresh and review the latest revision before continuing",
            409,
          );
      }
    }
    if (path[0] === "jobs" && path[1] && path[2] === "cancel") {
      const rows =
        await sql`UPDATE jobs SET cancel_requested_at=now() WHERE id=${path[1]} AND status IN ('queued','running') RETURNING resource_id`;
      return json({ resourceId: rows[0]?.resource_id ?? path[1] });
    }
    if (path[0] === "evals" && path.length === 1) {
      const input = await request.json();
      const [version] =
        await sql`SELECT id FROM skill_versions WHERE id=${String(input.skillVersionId)}`;
      if (!version)
        return fail("NOT_FOUND", "Skill version not found", "", 404);
      const id = crypto.randomUUID();
      await sql`INSERT INTO eval_versions(id,skill_version_id,status) VALUES(${id},${version.id},'collecting')`;
      if (input.taskDescription)
        await sql`INSERT INTO eval_files(eval_version_id,kind,filename,metadata) VALUES(${id},'task','task-description.txt',${sql.json({ text: String(input.taskDescription).slice(0, 100_000) })})`;
      return json({ resourceId: id }, 201);
    }
    if (path[0] === "evals" && path[1] && path[2] === "clone") {
      const input = await request.json();
      const [source] =
        await sql`SELECT * FROM eval_versions WHERE id=${path[1]} FOR SHARE`;
      if (!source) return fail("NOT_FOUND", "Evaluation not found", "", 404);
      const retained =
        input.preserveCases === true
          ? await sql`SELECT * FROM eval_cases WHERE eval_version_id=${source.id} ORDER BY case_id`
          : [];
      if (input.preserveCases === true && !retained.length)
        return fail(
          "NO_CASES",
          "No cases to retain",
          "Create a new test plan",
          409,
        );
      const id = crypto.randomUUID();
      await sql`INSERT INTO eval_versions(id,skill_version_id,status,evidence_level,task_understanding,coverage_plan,answers,questions) VALUES(${id},${source.skill_version_id},${retained.length ? "generating" : "collecting"},${source.evidence_level},${sql.json(source.task_understanding)},${sql.json(source.coverage_plan)},${sql.json(source.answers)},${sql.json(source.questions)})`;
      const materialIds = new Map<string, string>();
      for (const file of await sql`SELECT * FROM eval_files WHERE eval_version_id=${source.id}`) {
        const copiedId = crypto.randomUUID();
        materialIds.set(file.id, copiedId);
        await sql`INSERT INTO eval_files(id,eval_version_id,kind,filename,artifact_key,metadata) VALUES(${copiedId},${id},${file.kind},${file.filename},${file.artifact_key},${sql.json(file.metadata)})`;
      }
      if (source.coverage_plan?.areas?.length) {
        const plan = {
          ...source.coverage_plan,
          areas: source.coverage_plan.areas.map((area: any) => ({
            ...area,
            sourceReferences: area.sourceReferences.map((reference: any) => ({
              ...reference,
              materialId:
                materialIds.get(reference.materialId) ?? reference.materialId,
            })),
          })),
        };
        await sql`UPDATE eval_versions SET coverage_plan=${sql.json(plan)} WHERE id=${id}`;
      }
      for (const item of retained) {
        const rebound = remapCaseMaterials(item.source, materialIds);
        await sql`INSERT INTO eval_cases(eval_version_id,case_id,title,coverage_group,enabled,judge_type,evidence_provenance,required_dimensions,yaml_path,assertion_mapping,source) VALUES(${id},${item.case_id},${item.title},${item.coverage_group},${item.enabled},${item.judge_type},${sql.json(item.evidence_provenance)},${sql.json(item.required_dimensions)},${item.yaml_path},${sql.json(item.assertion_mapping)},${sql.json(rebound)})`;
      }
      if (retained.length)
        await enqueue(sql, "eval_generate", id, { rebuild: true });
      await recordDecision(
        sql,
        request.headers.get("x-skilled-user-id"),
        id,
        "clone_eval",
        { sourceEvalId: source.id, preserveCases: retained.length > 0 },
      );
      return json({ resourceId: id }, 201);
    }
    if (path[0] === "evals" && path[1] && path[2] === "materials") {
      const [draft] =
        await sql`SELECT status,revision FROM eval_versions WHERE id=${path[1]} FOR UPDATE`;
      if (
        !draft ||
        ![
          "collecting",
          "awaiting_answers",
          "awaiting_plan_approval",
          "ready",
          "failed",
        ].includes(draft.status)
      )
        return fail(
          "IMMUTABLE_EVAL",
          "Materials cannot change now",
          "Clone an approved evaluation or wait for its active job",
          409,
        );
      const upload = await multipart(request);
      try {
        if (
          upload.fields.expectedRevision &&
          Number(upload.fields.expectedRevision) !== Number(draft.revision)
        )
          return fail(
            "STALE_REVISION",
            "Evaluation changed",
            "Refresh before changing materials",
            409,
          );
        for (const file of upload.files) {
          const kind = MaterialKindSchema.parse(
            upload.fields[`kind:${file.filename}`] ?? "dataset",
          );
          const key = `eval-versions/${path[1]}/inputs/${crypto.randomUUID()}-${file.filename}`;
          const saved = await store.putFile(key, file.path);
          await sql`INSERT INTO eval_files(eval_version_id,kind,filename,artifact_key,metadata) VALUES(${path[1]},${kind},${file.filename},${key},${sql.json({ mime: file.mime, checksum: saved.checksum, visibility: materialVisibility(kind, upload.fields[`visibility:${file.filename}`]) })})`;
        }
        await sql`UPDATE eval_versions SET status='collecting',revision=revision+1,validation='{}' WHERE id=${path[1]}`;
        return json({ resourceId: path[1] }, 201);
      } finally {
        await rm(upload.directory, { recursive: true, force: true });
      }
    }
    if (path[0] === "skill" && path[1] === "upload") {
      const upload = await multipart(request);
      try {
        for (const file of upload.files.filter((f) => f.field === "taskFile"))
          MaterialKindSchema.parse(
            upload.fields[`kind:${file.filename}`] ?? "dataset",
          );
        const zip = upload.files.find((f) => f.field === "skill");
        if (!zip)
          return fail(
            "MISSING_SKILL",
            "Skill ZIP required",
            "Attach one ZIP in the skill field.",
            400,
            false,
            "skill",
          );
        const inspected = await inspectZip(zip.path);
        const selected = upload.fields.selectedRoot;
        if (inspected.roots.length > 1 && !selected)
          return json(
            {
              code: "ROOT_SELECTION_REQUIRED",
              title: "Select the Skill root",
              detail: "Several SKILL.md files were found.",
              retryable: true,
              correlationId: crypto.randomUUID(),
              candidates: inspected.roots,
            },
            409,
          );
        const root = selected ?? inspected.roots[0]!;
        if (!inspected.roots.includes(root))
          return fail(
            "INVALID_ROOT",
            "Invalid Skill root",
            "The selected root is not a discovered SKILL.md location.",
            400,
          );
        const extracted = join(upload.directory, "expanded");
        await extractZip(zip.path, extracted);
        const metadata = parseFrontmatter(
          await readFile(join(extracted, root, "SKILL.md"), "utf8"),
        );
        const targetSkillId = upload.fields.skillId;
        const [existingSkill] = targetSkillId
          ? await sql`SELECT * FROM skills WHERE id=${targetSkillId}`
          : await sql`SELECT * FROM skills WHERE name=${metadata.name}`;
        if (targetSkillId && !existingSkill)
          return fail(
            "NOT_FOUND",
            "Skill not found",
            "Choose an existing package",
            404,
          );
        if (!targetSkillId && existingSkill)
          return fail(
            "PACKAGE_EXISTS",
            "Package already exists",
            "Open this package and use Upload new version, or give the new package a different name.",
            409,
          );
        const skillId = existingSkill?.id ?? crypto.randomUUID();
        if (!existingSkill)
          await sql`INSERT INTO skills(id,name) VALUES(${skillId},${metadata.name})`;
        const [duplicate] =
          await sql`SELECT * FROM skill_versions WHERE skill_id=${skillId} AND checksum=${inspected.checksum} AND selected_root=${root} AND normalization_version='skilled-package-v2'`;
        const versionId = duplicate?.id ?? crypto.randomUUID();
        if (!duplicate) {
          const [versionRow] =
            await sql`SELECT COALESCE(max(version),0)+1 next FROM skill_versions WHERE skill_id=${skillId}`;
          const next = Number(versionRow!.next);
          const originalKey = `skill-versions/${versionId}/original.zip`,
            installableKey = `skill-versions/${versionId}/installable.zip`;
          await store.putFile(originalKey, zip.path);
          const included = inspected.entries
            .filter(
              (e) =>
                !e.directory &&
                e.path.startsWith(root ? `${root}/` : "") &&
                !excluded(e.path),
            )
            .map((e) => e.path);
          const installablePath = join(upload.directory, "installable.zip");
          await createZip(extracted, included, installablePath);
          const installed = await store.putFile(
            installableKey,
            installablePath,
          );
          const manifest = {
            entries: included.map((p) => ({
              path: root ? relative(root, p) : p,
              size: inspected.entries.find((e) => e.path === p)?.size ?? 0,
            })),
            excluded: inspected.entries
              .filter((e) => excluded(e.path))
              .map((e) => e.path),
          };
          const texts: Record<string, string> = {};
          for (const entry of manifest.entries
            .filter(
              (e) =>
                /\.md$|^agents\/openai\.yaml$/i.test(e.path) &&
                e.size < 1_000_000,
            )
            .slice(0, 100))
            texts[entry.path] = await readFile(
              join(extracted, root, entry.path),
              "utf8",
            );
          const assessment = assessPackage({
            name: metadata.name,
            selectedRoot: root,
            packageHash: installed.checksum,
            entries: manifest.entries,
            texts,
            excluded: manifest.excluded,
          });
          await sql`INSERT INTO skill_versions(id,skill_id,version,name,description,selected_root,root_candidates,manifest,package_assessment,readiness,status,checksum,original_key,installable_key,installable_checksum,normalization_version) VALUES(${versionId},${skillId},${Number(next)},${metadata.name},${metadata.description},${root},${sql.json(inspected.roots)},${sql.json(manifest)},${sql.json(assessment)},${sql.json({ ready: assessment.valid, findings: assessment.findings, checks: ["archive", "frontmatter"], execution: "not_checked" })},'ready',${inspected.checksum},${originalKey},${installableKey},${installed.checksum},'skilled-package-v2')`;
          // Activation is separate from intake, including the first version.
        }
        const evalId = crypto.randomUUID();
        const kinds = [
          "task",
          ...upload.files
            .filter((f) => f.field === "taskFile")
            .map((file) => upload.fields[`kind:${file.filename}`] ?? "dataset"),
        ];
        await sql`INSERT INTO eval_versions(id,skill_version_id,status,evidence_level) VALUES(${evalId},${versionId},'collecting',${evidenceLevel(kinds)})`;
        if (upload.fields.taskDescription)
          await sql`INSERT INTO eval_files(eval_version_id,kind,filename,metadata) VALUES(${evalId},'task','task-description.txt',${sql.json({ text: upload.fields.taskDescription })})`;
        for (const file of upload.files.filter((f) => f.field === "taskFile")) {
          const key = `eval-versions/${evalId}/inputs/${crypto.randomUUID()}-${file.filename}`;
          const savedMaterial = await store.putFile(key, file.path);
          await sql`INSERT INTO eval_files(eval_version_id,kind,filename,artifact_key,metadata) VALUES(${evalId},${upload.fields[`kind:${file.filename}`] ?? "dataset"},${file.filename},${key},${sql.json({ mime: file.mime, checksum: savedMaterial.checksum, visibility: materialVisibility(upload.fields[`kind:${file.filename}`] ?? "dataset", upload.fields[`visibility:${file.filename}`]) })})`;
        }
        return json(
          {
            jobId: null,
            resourceId: versionId,
            skillId,
            evalId,
            identical: Boolean(duplicate),
          },
          201,
        );
      } finally {
        await rm(upload.directory, { recursive: true, force: true });
      }
    }
    if (path[0] === "evals" && path[1] && path[2] === "author") {
      const evalId = path[1];
      const [authorTarget] =
        await sql`SELECT status FROM eval_versions WHERE id=${evalId} FOR UPDATE`;
      if (
        !authorTarget ||
        ![
          "collecting",
          "failed",
          "awaiting_answers",
          "awaiting_plan_approval",
          "ready",
        ].includes(authorTarget.status)
      )
        return fail(
          "IMMUTABLE_EVAL",
          "Clone this evaluation first",
          "Approved evaluations cannot be authored again",
          409,
        );
      const [existing] =
        await sql`SELECT id FROM conversations WHERE kind='eval_authoring' AND resource_id=${evalId} ORDER BY created_at DESC LIMIT 1`;
      const conversationId = existing?.id ?? crypto.randomUUID();
      if (!existing)
        await sql`INSERT INTO conversations(id,kind,resource_id) VALUES(${conversationId},'eval_authoring',${evalId})`;
      const [file] =
        await sql`SELECT metadata FROM eval_files WHERE eval_version_id=${evalId} AND kind='task' LIMIT 1`;
      if (!existing)
        await sql`INSERT INTO conversation_messages(conversation_id,role,content) VALUES(${conversationId},'user',${file?.metadata?.text ?? "Understand this Skill and create a rigorous eval plan."})`;
      const jobId = await enqueue(sql, "eval_author", evalId, {
        phase: "initial",
      });
      return json({ jobId, resourceId: evalId }, 202);
    }
    if (path[0] === "evals" && path[1] && path[2] === "answers") {
      const input = EvalAnswersSchema.parse(await request.json());
      const [evaluation] =
        await sql`SELECT questions FROM eval_versions WHERE id=${path[1]} AND status='awaiting_answers'`;
      if (!evaluation)
        return fail(
          "INVALID_TRANSITION",
          "Answers are not expected",
          "The eval must be waiting for material answers.",
          409,
        );
      const missing = (evaluation.questions as Array<any>)
        .filter(
          (question) =>
            question.required && !input.answers[question.id]?.trim(),
        )
        .map((question) => question.id);
      if (missing.length)
        return fail(
          "MISSING_ANSWERS",
          "Required answers are missing",
          `Answer: ${missing.join(", ")}`,
          400,
          false,
          "answers",
        );
      const [conversation] =
        await sql`SELECT id FROM conversations WHERE resource_id=${path[1]} AND kind='eval_authoring' ORDER BY created_at DESC LIMIT 1`;
      if (!conversation)
        return fail("NOT_FOUND", "Conversation not found", "", 404);
      await inTransaction(sql, async (tx) => {
        await tx`UPDATE eval_versions SET answers=${tx.json(input.answers)},status='planning' WHERE id=${path[1]!}`;
        await tx`INSERT INTO conversation_messages(conversation_id,role,content,structured) VALUES(${conversation.id},'user',${Object.entries(
          input.answers,
        )
          .map(([id, answer]) => `${id}: ${answer}`)
          .join("\n")},${tx.json(input.answers)})`;
      });
      const jobId = await enqueue(sql, "eval_author", path[1], {
        phase: "answers",
      });
      return json({ jobId, resourceId: path[1] }, 202);
    }
    if (path[0] === "evals" && path[1] && path[2] === "messages") {
      const input = ConversationMessageSchema.parse(await request.json());
      const [conversation] =
        await sql`SELECT id FROM conversations WHERE resource_id=${path[1]} AND kind='eval_authoring' ORDER BY created_at DESC LIMIT 1`;
      if (!conversation)
        return fail("NOT_FOUND", "Conversation not found", "", 404);
      await sql`INSERT INTO conversation_messages(conversation_id,role,content) VALUES(${conversation.id},'user',${input.message})`;
      const jobId = await enqueue(sql, "eval_author", path[1], {
        phase: "message",
        message: input.message,
      });
      return json({ jobId, resourceId: path[1] }, 202);
    }
    if (path[0] === "evals" && path[1] && path[2] === "apply-revision") {
      const input = await request.json();
      const [draft] =
        await sql`SELECT status,revision FROM eval_versions WHERE id=${path[1]} FOR UPDATE`;
      if (
        !draft ||
        ![
          "ready",
          "failed",
          "awaiting_answers",
          "awaiting_plan_approval",
        ].includes(draft.status)
      )
        return fail(
          "IMMUTABLE_EVAL",
          "Revision cannot be applied",
          "Clone an approved evaluation or wait for the current operation",
          409,
        );
      const [message] =
        await sql`SELECT m.structured FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.id=${String(input.messageId)} AND c.resource_id=${path[1]} AND c.kind='eval_authoring' AND m.completed=true AND m.role='assistant'`;
      if (message?.structured?.baseRevision !== draft.revision)
        return fail(
          "STALE_PROPOSAL",
          "This revision belongs to an older draft",
          "Request a new proposal against the current task and coverage.",
          409,
        );
      const proposed = AuthoringRevisionSchema.parse(message?.structured);
      if (!proposed.revision)
        return fail("NO_REVISION", "No structured revision", "", 400);
      if (!proposed.revision.plan.areas.length)
        return fail(
          "MISSING_AREAS",
          "A revision needs task-specific judging areas",
          "Ask for explicit areas and assertion roles before applying this change.",
          409,
        );
      validateCoverage(proposed.revision.plan);
      await sql`DELETE FROM eval_cases WHERE eval_version_id=${path[1]}`;
      const total = proposed.revision.plan.groups.reduce(
        (sum, group) => sum + group.caseCount,
        0,
      );
      if (total < 1 || total > 50)
        return fail(
          "COVERAGE_LIMIT",
          "Coverage must fit the pilot limit",
          "Choose between 1 and 50 cases before applying the revision",
          409,
        );
      await sql`UPDATE eval_versions SET task_understanding=${sql.json(proposed.revision.understanding)},coverage_plan=${sql.json(proposed.revision.plan)},revision=revision+1,status='awaiting_plan_approval',validation='{}' WHERE id=${path[1]}`;
      await recordDecision(
        sql,
        request.headers.get("x-skilled-user-id"),
        path[1],
        "apply_eval_revision",
        { messageId: input.messageId, revision: draft.revision },
      );
      return json({ resourceId: path[1] });
    }
    if (path[0] === "evals" && path[1] && path[2] === "approve-plan") {
      const [draft] =
        await sql`SELECT ev.*,sv.installable_checksum package_hash FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id WHERE ev.id=${path[1]} FOR UPDATE OF ev`;
      if (!draft) return fail("NOT_FOUND", "Evaluation not found", "", 404);
      const plan = CoveragePlanSchema.parse(draft.coverage_plan);
      validateCoverage(plan);
      const input = await request.json();
      const hash = profileHash(draft.coverage_plan, draft.task_understanding);
      if (
        plan.areas.length &&
        (input.expectedRevision !== draft.revision ||
          input.profileHash !== hash)
      )
        return fail(
          "STALE_PROFILE",
          "Review the latest judging areas",
          "The approval must match this exact profile and revision.",
          409,
        );
      const materials =
        await sql`SELECT id,metadata FROM eval_files WHERE eval_version_id=${path[1]} ORDER BY id`;
      await sql`UPDATE eval_versions SET profile_hash=${hash} WHERE id=${path[1]} AND status='awaiting_plan_approval'`;
      await recordDecision(
        sql,
        request.headers.get("x-skilled-user-id"),
        path[1],
        "approve_profile",
        {
          revision: draft.revision,
          profileHash: hash,
          packageHash: draft.package_hash,
          materials,
        },
      );

      const [id] =
        await sql`UPDATE eval_versions SET status='generating' WHERE id=${path[1]} AND status='awaiting_plan_approval' RETURNING id`;
      if (!id)
        return fail(
          "INVALID_TRANSITION",
          "Plan cannot be approved",
          "The eval must be awaiting plan approval.",
          409,
        );
      const jobId = await enqueue(sql, "eval_generate", path[1], {});
      return json({ jobId, resourceId: path[1] }, 202);
    }
    if (path[0] === "evals" && path[1] && path[2] === "retry") {
      const [failedJob] =
        await sql`SELECT type,payload FROM jobs WHERE resource_id=${path[1]} AND type IN ('eval_author','eval_generate') AND status IN ('failed','interrupted') ORDER BY completed_at DESC NULLS LAST,created_at DESC LIMIT 1`;
      if (!failedJob)
        return fail(
          "NO_FAILED_STEP",
          "No failed evaluation step found",
          "Refresh to recover the latest evaluation state.",
          409,
        );
      const retryAuthoring = failedJob?.type === "eval_author";
      const [row] =
        await sql`UPDATE eval_versions SET status=${retryAuthoring ? "understanding" : "generating"},validation='{}' WHERE id=${path[1]} AND status='failed' RETURNING id`;
      if (!row)
        return fail(
          "INVALID_TRANSITION",
          "Eval cannot be retried",
          "Only failed evaluation work can be retried.",
          409,
        );
      const jobId = await enqueue(
        sql,
        retryAuthoring ? "eval_author" : "eval_generate",
        path[1],
        { ...(failedJob.payload ?? {}), retry: true },
      );
      return json({ jobId, resourceId: path[1] }, 202);
    }
    if (path[0] === "evals" && path[1] && path[2] === "approve") {
      const [draft] =
        await sql`SELECT * FROM eval_versions WHERE id=${path[1]} FOR UPDATE`;
      if (!draft) return fail("NOT_FOUND", "Evaluation not found", "", 404);
      const approvedProfileHash = draft.coverage_plan?.areas?.length
        ? profileHash(draft.coverage_plan, draft.task_understanding)
        : draft.profile_hash;
      if (draft.coverage_plan?.areas?.length) {
        const plan = CoveragePlanSchema.parse(draft.coverage_plan);
        const records =
          await sql`SELECT source FROM eval_cases WHERE eval_version_id=${path[1]} AND enabled=true ORDER BY case_id`;
        validateCoverage(
          plan,
          records.map((r) => GeneratedEvalCaseSchema.parse(r.source)),
        );
        const input = await request.json();
        if (
          input.expectedRevision !== draft.revision ||
          input.profileHash !==
            profileHash(draft.coverage_plan, draft.task_understanding)
        )
          return fail(
            "STALE_PROFILE",
            "Review the latest test plan",
            "Approval must match the generated tests and profile revision.",
            409,
          );
      }
      const [row] =
        await sql`UPDATE eval_versions target SET status='approved',profile_hash=${approvedProfileHash ?? null},version=(SELECT COALESCE(max(other.version),0)+1 FROM eval_versions other JOIN skill_versions other_sv ON other_sv.id=other.skill_version_id WHERE other.version IS NOT NULL AND other_sv.skill_id=(SELECT target_sv.skill_id FROM skill_versions target_sv WHERE target_sv.id=target.skill_version_id)),approved_at=now() WHERE target.id=${path[1]} AND target.status='ready' AND (target.validation->>'valid')::boolean=true RETURNING target.id`;
      if (row)
        await recordDecision(
          sql,
          request.headers.get("x-skilled-user-id"),
          row.id,
          "approve_eval",
          {
            evalId: row.id,
            revision: draft.revision,
            profileHash: approvedProfileHash,
            bundleHash: draft.checksum,
          },
        );
      return row
        ? json({ resourceId: row.id, status: "approved" })
        : fail(
            "INVALID_TRANSITION",
            "Eval cannot be approved",
            "A valid ready draft is required.",
            409,
          );
    }
    if (path[0] === "runs" && path[1] === "launch") {
      const input = RunLaunchSchema.parse(await request.json());
      const [sv] =
        await sql`SELECT checksum,installable_checksum,skill_id,package_assessment FROM skill_versions WHERE id=${input.skillVersionId}`;
      const [ev] =
        await sql`SELECT ev.checksum,ev.status,ev.task_understanding,ev.profile_hash,sv.skill_id FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id WHERE ev.id=${input.evalVersionId}`;
      if (!sv || !ev || ev.status !== "approved" || sv.skill_id !== ev.skill_id)
        return fail(
          "NOT_READY",
          "Approved eval and Skill required",
          "Approve the eval before launching.",
          409,
        );
      const unsupported = unsupportedRequirements(
        ev.task_understanding?.dependencies,
      );
      if (process.env.SKILLED_ADAPTER_MODE !== "fake" && unsupported.length)
        return fail(
          "UNSUPPORTED_RUNTIME",
          "Runtime requirements are unavailable",
          `This installation cannot provide: ${unsupported.join(", ")}. Review the capability manifest and revise the task.`,
          409,
        );
      if (
        sv.package_assessment &&
        (!sv.package_assessment.valid ||
          sv.package_assessment.runtime === "unsupported")
      )
        return fail(
          "PACKAGE_BLOCKED",
          "Package needs attention",
          "Resolve package findings before launching a run.",
          409,
        );
      const approvedCases =
        await sql`SELECT case_id FROM eval_cases WHERE eval_version_id=${input.evalVersionId} AND enabled=true ORDER BY case_id`;
      const selectedCaseIds =
        input.selectedCaseIds ?? approvedCases.map((c) => String(c.case_id));
      if (
        !selectedCaseIds.length ||
        new Set(selectedCaseIds).size !== selectedCaseIds.length ||
        selectedCaseIds.some(
          (id) => !approvedCases.some((c) => c.case_id === id),
        )
      )
        return fail(
          "INVALID_CASE_SELECTION",
          "Select approved cases",
          "The run must contain unique enabled cases from this evaluation",
          400,
        );
      const runId = crypto.randomUUID();
      await sql`INSERT INTO runs(id,skill_version_id,eval_version_id,model,settings,skill_checksum,eval_checksum,baseline,iterations,provenance_status) VALUES(${runId},${input.skillVersionId},${input.evalVersionId},${input.model},${sql.json({ parallelism: 1, retries: { correctness: 0, transient: 1 }, environment: "none", profileHash: ev.profile_hash ?? null, selectedCaseIds, adapter: process.env.SKILLED_ADAPTER_MODE === "fake" ? "demo" : "real" })},${sv.checksum},${ev.checksum},${input.baseline},${input.iterations},'verified_pipeline')`;
      const jobId = await enqueue(sql, "run", runId, input);
      await sql`UPDATE runs SET job_id=${jobId} WHERE id=${runId}`;
      return json({ jobId, resourceId: runId }, 202);
    }
    if (path[0] === "runs" && path[1] && path[2] === "cancel") {
      const [run] = await sql`SELECT job_id FROM runs WHERE id=${path[1]}`;
      if (!run) return fail("NOT_FOUND", "Run not found", "", 404);
      await sql`UPDATE jobs SET cancel_requested_at=now() WHERE id=${run.job_id} AND status IN ('queued','running')`;
      await sql`UPDATE runs SET status='cancelling' WHERE id=${path[1]} AND status IN ('queued','preparing','running','judging')`;
      return json({ jobId: run.job_id, resourceId: path[1] }, 202);
    }
    if (path[0] === "updates" && path[1] === "generate") {
      const body = (await request.json()) as { runId: string };
      const [run] =
        await sql`SELECT * FROM runs WHERE id=${body.runId} AND status='completed'`;
      if (!run) return fail("NOT_READY", "Completed run required", "", 409);
      if (run.provenance_status === "legacy_unverified")
        return fail(
          "LEGACY_EVIDENCE",
          "Rerun imported history",
          "Imported results cannot certify a new improvement. Launch a run through the corrected pipeline first.",
          409,
        );
      const proposalId = crypto.randomUUID();
      await sql`INSERT INTO update_proposals(id,source_run_id,base_version_id,eval_version_id) VALUES(${proposalId},${run.id},${run.skill_version_id},${run.eval_version_id})`;
      const conversationId = crypto.randomUUID();
      await sql`INSERT INTO conversations(id,kind,resource_id) VALUES(${conversationId},'skill_update',${proposalId})`;
      await sql`INSERT INTO conversation_messages(conversation_id,role,content) VALUES(${conversationId},'user','Diagnose the selected failures and propose the smallest safe Skill improvement.')`;
      const jobId = await enqueue(sql, "proposal", proposalId, {});
      return json({ jobId, resourceId: proposalId }, 202);
    }
    if (path[0] === "updates" && path[1] && path[2] === "messages") {
      const input = ConversationMessageSchema.parse(await request.json());
      const [proposal] =
        await sql`SELECT id FROM update_proposals WHERE id=${path[1]} AND status='review'`;
      if (!proposal)
        return fail(
          "NOT_READY",
          "Proposal cannot be revised",
          "Only a proposal under review accepts revision requests.",
          409,
        );
      const [conversation] =
        await sql`SELECT id FROM conversations WHERE resource_id=${path[1]} AND kind='skill_update' ORDER BY created_at DESC LIMIT 1`;
      if (!conversation)
        return fail("NOT_FOUND", "Conversation not found", "", 404);
      await inTransaction(sql, async (tx) => {
        await tx`INSERT INTO conversation_messages(conversation_id,role,content) VALUES(${conversation.id},'user',${input.message})`;
        await tx`UPDATE update_proposals SET status='generating',updated_at=now() WHERE id=${path[1]!}`;
      });
      const jobId = await enqueue(sql, "proposal", path[1], {
        message: input.message,
      });
      return json({ jobId, resourceId: path[1] }, 202);
    }
    if (path[0] === "updates" && path[1] && path[2] === "decide") {
      const input = ProposalDecisionSchema.parse(await request.json());
      const [p] =
        await sql`SELECT p.id proposal_id,p.base_version_id,p.eval_version_id,p.skill_patch_key,p.skill_changes,p.eval_changes,sv.skill_id,sv.name,sv.description,sv.selected_root,sv.root_candidates,sv.manifest,sv.readiness,sv.installable_key FROM update_proposals p JOIN skill_versions sv ON sv.id=p.base_version_id WHERE p.id=${path[1]} AND p.status='review'`;
      if (!p) return fail("NOT_READY", "Proposal is not reviewable", "", 409);
      if (input.skillDecision === "rejected") {
        await sql`UPDATE update_proposals SET status='rejected',skill_decision='rejected',eval_decision=${input.evalDecision},updated_at=now() WHERE id=${p.proposal_id}`;
        return json({ resourceId: p.proposal_id, status: "rejected" });
      }
      const versionRows =
        await sql`SELECT max(version)+1 next FROM skill_versions WHERE skill_id=${p.skill_id}`;
      const next = versionRows[0]?.next;
      if (!next) throw new Error("Could not allocate candidate version");
      const candidate = crypto.randomUUID();
      if (!p.skill_patch_key || !Array.isArray(p.skill_changes))
        throw new Error("Approved proposal has no Skill patch");
      const candidateWork = await mkdtemp(join(tmpdir(), "skilled-candidate-"));
      let candidateChecksum: string,
        candidateKey: string,
        candidateManifest: any,
        candidateMetadata: { name: string; description: string },
        candidateAssessment: ReturnType<typeof assessPackage>;
      try {
        const inspected = await extractZip(
          await store.materialize(p.installable_key),
          candidateWork,
        );
        const skillRoot = resolve(candidateWork, p.selected_root);
        if (
          relative(candidateWork, skillRoot).startsWith("..") ||
          /(^|\/)\.\.(\/|$)/.test(p.selected_root)
        )
          throw new Error("Unsafe Skill root");
        candidateMetadata = await applyFileChanges(
          skillRoot,
          p.skill_changes as FileChange[],
        );
        const output = join(candidateWork, "candidate.zip");
        const entries = (await packageFiles(skillRoot)).map((file) =>
          p.selected_root ? `${p.selected_root}/${file}` : file,
        );
        await createZip(candidateWork, entries, output);
        const bytes = await readFile(output);
        candidateChecksum = sha256(bytes);
        const candidateInspection = await inspectZip(output);
        candidateManifest = {
          entries: candidateInspection.entries
            .filter((entry) => !entry.directory)
            .map((entry) => ({
              path: p.selected_root
                ? relative(p.selected_root, entry.path)
                : entry.path,
              size: entry.size,
            })),
          excluded: [],
        };
        const candidateTexts: Record<string, string> = {};
        for (const entry of candidateManifest.entries
          .filter(
            (e: any) =>
              /\.md$|^agents\/openai\.yaml$/i.test(e.path) &&
              e.size < 1_000_000,
          )
          .slice(0, 100))
          candidateTexts[entry.path] = await readFile(
            join(skillRoot, entry.path),
            "utf8",
          );
        candidateAssessment = assessPackage({
          name: p.name,
          selectedRoot: p.selected_root,
          packageHash: candidateChecksum,
          entries: candidateManifest.entries,
          texts: candidateTexts,
        });
        if (
          !candidateAssessment.valid ||
          candidateAssessment.runtime === "unsupported"
        )
          throw new Error(
            "Candidate package validation failed: " +
              candidateAssessment.findings.map((f) => f.message).join("; "),
          );
        candidateKey = `skill-versions/${candidate}/installable.zip`;
        await store.put(candidateKey, bytes);
      } finally {
        await rm(candidateWork, { recursive: true, force: true });
      }
      await sql`INSERT INTO skill_versions(id,skill_id,version,name,description,selected_root,root_candidates,manifest,package_assessment,readiness,status,checksum,original_key,installable_key,base_version_id,installable_checksum,normalization_version) VALUES(${candidate},${p.skill_id},${Number(next)},${candidateMetadata!.name},${candidateMetadata!.description},${p.selected_root},${sql.json(p.root_candidates)},${sql.json(candidateManifest!)},${sql.json(candidateAssessment!)},${sql.json({ ready: true, checks: ["archive", "frontmatter"], execution: "not_checked" })},'candidate',${candidateChecksum!},${candidateKey!},${candidateKey!},${p.base_version_id},${candidateChecksum!},'skilled-package-v2')`;
      let verificationEvalId = p.eval_version_id;
      if (
        input.evalDecision === "approved" &&
        Array.isArray(p.eval_changes) &&
        p.eval_changes.length
      ) {
        const [sourceEval] =
          await sql`SELECT * FROM eval_versions WHERE id=${p.eval_version_id} AND status='approved'`;
        if (!sourceEval?.bundle_key)
          throw new Error("Approved source eval bundle is missing");
        const nextEvalRows =
          await sql`SELECT COALESCE(max(ev.version),0)+1 next FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id WHERE sv.skill_id=${p.skill_id}`;
        verificationEvalId = crypto.randomUUID();
        const sourceCases =
          await sql`SELECT * FROM eval_cases WHERE eval_version_id=${p.eval_version_id} ORDER BY case_id`;
        const changes = new Map(
          (p.eval_changes as Array<Record<string, any>>).map((change) => [
            change.caseId,
            change,
          ]),
        );
        if (
          changes.size !== p.eval_changes.length ||
          [...changes.keys()].some(
            (id) => !sourceCases.some((c) => c.case_id === id),
          )
        )
          throw new Error("Eval patch contains duplicate or unknown case IDs");
        await sql`INSERT INTO eval_versions(id,skill_version_id,revision,status,evidence_level,task_understanding,coverage_plan,answers,questions,validation) VALUES(${verificationEvalId},${p.base_version_id},1,'generating',${sourceEval.evidence_level},${sql.json(sourceEval.task_understanding)},${sql.json(sourceEval.coverage_plan)},${sql.json(sourceEval.answers)},${sql.json(sourceEval.questions)},${sql.json({ valid: false, derivedFrom: p.eval_version_id, proposalId: p.proposal_id })})`;
        const materialIds = new Map<string, string>();
        for (const material of await sql`SELECT * FROM eval_files WHERE eval_version_id=${p.eval_version_id}`) {
          const copiedId = crypto.randomUUID();
          materialIds.set(material.id, copiedId);
          await sql`INSERT INTO eval_files(id,eval_version_id,kind,filename,artifact_key,metadata) VALUES(${copiedId},${verificationEvalId},${material.kind},${material.filename},${material.artifact_key},${sql.json(material.metadata)})`;
        }
        if (sourceEval.coverage_plan?.areas?.length) {
          const reboundPlan = {
            ...sourceEval.coverage_plan,
            areas: sourceEval.coverage_plan.areas.map((area: any) => ({
              ...area,
              sourceReferences: area.sourceReferences.map((reference: any) => ({
                ...reference,
                materialId:
                  materialIds.get(reference.materialId) ?? reference.materialId,
              })),
            })),
          };
          await sql`UPDATE eval_versions SET coverage_plan=${sql.json(reboundPlan)} WHERE id=${verificationEvalId}`;
        }
        for (const item of sourceCases) {
          const change = changes.get(item.case_id);
          const source = GeneratedEvalCaseSchema.parse(item.source);
          if (change?.prompt) source.prompt = String(change.prompt);
          if (change?.criteria) {
            if (
              change.criteria.length !==
                (source.assertions.length || source.dimensions.length) ||
              new Set(change.criteria).size !== change.criteria.length
            )
              throw new Error("Each assertion needs one distinct criterion");
            if (item.judge_type === "script" && !change.deterministicChecks)
              throw new Error(
                "Script rubric changes require explicit regenerated validators before approval",
              );
            source.criteria = change.criteria;
            if (source.assertions?.length) {
              if (change.criteria.length !== source.assertions.length)
                throw new Error(
                  "Changed criteria must match explicit assertions",
                );
              source.assertions = source.assertions.map(
                (a: any, i: number) => ({ ...a, text: change.criteria[i] }),
              );
            }
          }
          if (change?.deterministicChecks)
            source.deterministicChecks = change.deterministicChecks;
          const rebound = remapCaseMaterials(source, materialIds);
          await sql`INSERT INTO eval_cases(eval_version_id,case_id,title,coverage_group,enabled,judge_type,evidence_provenance,required_dimensions,yaml_path,assertion_mapping,source) VALUES(${verificationEvalId},${item.case_id},${item.title},${item.coverage_group},${item.enabled},${item.judge_type},${sql.json(item.evidence_provenance)},${sql.json(item.required_dimensions)},${item.yaml_path},${sql.json(item.assertion_mapping)},${sql.json(rebound)})`;
        }
      }

      if (verificationEvalId !== p.eval_version_id)
        await enqueue(sql, "eval_generate", verificationEvalId, {
          rebuild: true,
        });
      await recordDecision(
        sql,
        request.headers.get("x-skilled-user-id"),
        p.proposal_id,
        "decide_proposal",
        {
          ...input,
          baseVersionId: p.base_version_id,
          candidateVersionId: candidate,
        },
      );
      await sql`UPDATE update_proposals SET source_eval_version_id=COALESCE(source_eval_version_id,eval_version_id),status='candidate_created' ,skill_decision='approved',eval_decision=${input.evalDecision},candidate_version_id=${candidate},eval_version_id=${verificationEvalId},updated_at=now() WHERE id=${p.proposal_id}`;
      return json(
        {
          resourceId: p.proposal_id,
          candidateVersionId: candidate,
          status: "candidate_created",
        },
        202,
      );
    }
    if (path[0] === "updates" && path[1] && path[2] === "verify") {
      const [p] =
        await sql`SELECT * FROM update_proposals WHERE id=${path[1]} AND status IN ('candidate_created','failed') AND candidate_version_id IS NOT NULL`;
      if (!p)
        return fail(
          "NOT_READY",
          "Candidate is not ready for verification",
          "",
          409,
        );
      const [base] =
        await sql`SELECT checksum FROM skill_versions WHERE id=${p.base_version_id}`;
      const [candidate] =
        await sql`SELECT checksum FROM skill_versions WHERE id=${p.candidate_version_id}`;
      const [ev] =
        await sql`SELECT checksum,profile_hash FROM eval_versions WHERE id=${p.eval_version_id} AND status='approved' AND (validation->>'valid')::boolean=true`;
      if (!base || !candidate || !ev)
        return fail(
          "MISSING_VERSION",
          "Verification inputs are missing",
          "The base, candidate, or eval version no longer exists.",
          409,
        );
      const currentRun = crypto.randomUUID(),
        candidateRun = crypto.randomUUID();
      const settings = {
        parallelism: 1,
        retries: { correctness: 0, transient: 1 },
        environment: "none",
        comparison: true,
        profileHash: ev.profile_hash ?? null,
      };
      for (const [id, version, checksum] of [
        [currentRun, p.base_version_id, base.checksum],
        [candidateRun, p.candidate_version_id, candidate.checksum],
      ])
        await sql`INSERT INTO runs(id,skill_version_id,eval_version_id,model,settings,skill_checksum,eval_checksum,iterations,status,provenance_status) VALUES(${id},${version},${p.eval_version_id},'gpt-5.6-luna',${sql.json(settings)},${checksum},${ev.checksum},3,'queued','verified_pipeline')`;
      const currentJob = await enqueue(sql, "run", currentRun, {
        comparison: "current",
      });
      const candidateJob = await enqueue(sql, "run", candidateRun, {
        comparison: "candidate",
      });
      await sql`UPDATE runs SET job_id=${currentJob} WHERE id=${currentRun}`;
      await sql`UPDATE runs SET job_id=${candidateJob} WHERE id=${candidateRun}`;
      await sql`UPDATE update_proposals SET status='verifying',current_verification_run_id=${currentRun},candidate_verification_run_id=${candidateRun},updated_at=now() WHERE id=${p.id}`;
      return json(
        { jobId: currentJob, resourceId: p.id, candidateJobId: candidateJob },
        202,
      );
    }
    if (path[0] === "updates" && path[1] && path[2] === "activate") {
      const activationInput = request.headers
        .get("content-type")
        ?.includes("application/json")
        ? await request.clone().json()
        : {};
      const [p] =
        await sql`SELECT p.*,sv.skill_id FROM update_proposals p JOIN skill_versions sv ON sv.id=p.candidate_version_id WHERE p.id=${path[1]} AND p.status='verified'`;
      if (!p)
        return fail(
          "BLOCKED",
          "Candidate cannot be activated",
          "Verification must finish without blocking regressions.",
          409,
        );
      await inTransaction(sql, async (tx) => {
        const [selected] =
          await tx`SELECT active_version_id FROM skills WHERE id=${p.skill_id} FOR UPDATE`;
        if (
          p.activated_at &&
          selected?.active_version_id === p.candidate_version_id
        )
          return;
        if (
          "expectedActiveVersionId" in activationInput &&
          activationInput.expectedActiveVersionId !==
            selected?.active_version_id
        )
          throw Object.assign(
            new Error("Active version changed since review"),
            { status: 409 },
          );
        if (
          selected?.active_version_id &&
          selected.active_version_id !== p.base_version_id
        )
          throw Object.assign(
            new Error(
              "Active version changed; verify a new candidate against the current base",
            ),
            { status: 409 },
          );
        const [verified] =
          await tx`SELECT provenance_status,engine_versions FROM runs WHERE id=${p.candidate_verification_run_id}`;
        if (
          process.env.SKILLED_ADAPTER_MODE !== "fake" &&
          verified?.engine_versions?.adapter !== "real"
        )
          throw new Error("Demo evidence cannot authorize real activation");
        if (verified?.provenance_status !== "verified_pipeline")
          throw new Error("Imported verification must be rerun");
        await tx`UPDATE skills SET active_version_id=${p.candidate_version_id},updated_at=now() WHERE id=${p.skill_id} AND (active_version_id=${p.base_version_id} OR active_version_id IS NULL) RETURNING id`;
        // Skill versions remain immutable after activation.
        await recordDecision(
          tx,
          request.headers.get("x-skilled-user-id"),
          p.id,
          "activate",
          {
            current: selected?.active_version_id,
            candidate: p.candidate_version_id,
            comparison: p.comparison,
          },
        );
        await tx`UPDATE update_proposals SET activated_at=now(),updated_at=now() WHERE id=${p.id}`;
      });
      return json({ resourceId: p.candidate_version_id, status: "active" });
    }
    return fail(
      "NOT_FOUND",
      "Endpoint not found",
      `Unknown API path: ${path.join("/")}`,
      404,
    );
  } catch (cause) {
    if (
      (cause as any)?.status === 409 ||
      ["23514", "23505", "40001"].includes((cause as any)?.code)
    )
      return fail(
        "STATE_CONFLICT",
        "The resource changed; refresh before retrying",
        cause instanceof Error ? cause.message : String(cause),
        409,
      );
    if ((cause as any)?.issues)
      return fail(
        "VALIDATION",
        "Invalid request",
        JSON.stringify((cause as any).issues),
        400,
      );
    return fail(
      "INTERNAL",
      "Request failed",
      cause instanceof Error ? cause.message : String(cause),
      500,
      true,
    );
  }
}

export async function PATCH(request: Request, context: Context) {
  return mutation(request, (tx) => patch(request, context, tx));
}
async function patch(request: Request, context: Context, sql: Db) {
  await ready;
  const { path } = await context.params;
  try {
    if (path[0] === "evals" && path[1] && path[2] === "materials" && path[3]) {
      const input = await request.json();
      const [draft] =
        await sql`SELECT revision,status FROM eval_versions WHERE id=${path[1]} FOR UPDATE`;
      if (
        !draft ||
        ![
          "collecting",
          "awaiting_answers",
          "awaiting_plan_approval",
          "ready",
          "failed",
        ].includes(draft.status)
      )
        return fail(
          "IMMUTABLE_EVAL",
          "Materials cannot change now",
          "Clone an approved evaluation or wait for its job",
          409,
        );
      if (Number(input.expectedRevision) !== Number(draft.revision))
        return fail(
          "STALE_REVISION",
          "Evaluation changed",
          "Refresh before editing",
          409,
        );
      const [material] =
        await sql`SELECT * FROM eval_files WHERE id=${path[3]} AND eval_version_id=${path[1]}`;
      if (!material) return fail("NOT_FOUND", "Material not found", "", 404);
      const kind = input.kind
        ? MaterialKindSchema.parse(input.kind)
        : material.kind;
      const visibility = materialVisibility(
        kind,
        input.visibility ??
          (input.kind ? undefined : material.metadata?.visibility),
      );
      const rows =
        input.remove === true
          ? await sql`DELETE FROM eval_files WHERE id=${path[3]} AND eval_version_id=${path[1]} RETURNING id`
          : await sql`UPDATE eval_files SET kind=${kind},metadata=${sql.json({ ...material.metadata, visibility })} WHERE id=${path[3]} AND eval_version_id=${path[1]} RETURNING id`;
      if (!rows.length) return fail("NOT_FOUND", "Material not found", "", 404);
      await sql`DELETE FROM eval_cases WHERE eval_version_id=${path[1]}`;
      await sql`UPDATE eval_versions SET revision=revision+1,status='collecting',coverage_plan='{}',task_understanding='{}',profile_hash=NULL,validation='{}' WHERE id=${path[1]}`;
      return json({ resourceId: path[1] });
    }
    if (path[0] === "evals" && path[1] && path[2] === "cases" && path[3]) {
      const [draft] =
        await sql`SELECT status,revision FROM eval_versions WHERE id=${path[1]} FOR UPDATE`;
      if (!draft || !["ready", "failed"].includes(draft.status))
        return fail(
          "IMMUTABLE_EVAL",
          "Clone this evaluation first",
          "Approved evaluation contents cannot change",
          409,
        );
      const body = (await request.json()) as {
        enabled?: boolean;
        source?: unknown;
        expectedRevision?: number;
      };
      if (
        body.expectedRevision !== undefined &&
        body.expectedRevision !== Number(draft.revision)
      )
        return fail(
          "STALE_REVISION",
          "Evaluation changed",
          "Refresh before editing",
          409,
        );
      const enabled = body.enabled ?? null;
      const source =
        body.source === undefined ? null : sql.json(body.source as never);
      const [row] =
        await sql`UPDATE eval_cases SET enabled=COALESCE(${enabled},enabled),source=COALESCE(${source},source) WHERE eval_version_id=${path[1]} AND case_id=${path[3]} RETURNING *`;
      if (!row) return fail("NOT_FOUND", "Case not found", "", 404);
      await sql`UPDATE eval_versions SET revision=revision+1,status='generating',validation='{}' WHERE id=${path[1]}`;
      const jobId = await enqueue(sql, "eval_generate", path[1], {
        rebuild: true,
      });
      return json({ ...row, jobId }, 202);
    }
    return fail("NOT_FOUND", "Endpoint not found", "", 404);
  } catch (cause) {
    if (
      (cause as any)?.status === 409 ||
      ["23514", "23505", "40001"].includes((cause as any)?.code)
    )
      return fail(
        "STATE_CONFLICT",
        "The resource changed; refresh before retrying",
        cause instanceof Error ? cause.message : String(cause),
        409,
      );
    return fail(
      "INTERNAL",
      "Request failed",
      cause instanceof Error ? cause.message : String(cause),
      500,
      true,
    );
  }
}
