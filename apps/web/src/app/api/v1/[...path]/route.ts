import {
  ArtifactStore,
  canonicalSkillChangePath,
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
  sha256,
} from "@skilled/core";
import Busboy from "busboy";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
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

async function multipart(request: Request) {
  const directory = await mkdtemp(join(tmpdir(), "skilled-upload-"));
  const files: {
    field: string;
    filename: string;
    path: string;
    mime: string;
  }[] = [];
  const fields: Record<string, string> = {};
  await new Promise<void>((done, reject) => {
    const bb = Busboy({
      headers: Object.fromEntries(request.headers),
      limits: { fileSize: 100 * 1024 * 1024, files: 30, fields: 30 },
    });
    bb.on("file", (field, stream, info) => {
      const path = join(
        directory,
        `${crypto.randomUUID()}-${basename(info.filename)}`,
      );
      files.push({
        field,
        filename: basename(info.filename),
        path,
        mime: info.mimeType,
      });
      stream.pipe(createWriteStream(path));
      stream.on("limit", () => reject(new Error("Upload exceeds 100 MiB")));
    });
    bb.on("field", (name, value) => {
      fields[name] = value;
    });
    bb.on("finish", done);
    bb.on("error", reject);
    Readable.fromWeb(request.body as never).pipe(bb);
  });
  return { directory, files, fields };
}
function parseFrontmatter(text: string) {
  const head = text.match(/^---\s*\n([\s\S]*?)\n---/);
  const source = head?.[1] ?? "";
  return {
    name:
      source.match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim() ??
      "Uploaded Skill",
    description:
      source.match(/^description:\s*["']?([^\n"']+)/m)?.[1]?.trim() ?? "",
  };
}
const excluded = (path: string) =>
  /(^|\/)(evals?|runs?|outputs?|test-results|\.git|\.svn|\.hg|\.env|auth\.json|__MACOSX|node_modules)(\/|$)/i.test(
    path,
  ) || /(^|\/)(\.DS_Store|.*\.tmp)$/.test(path);

export async function GET(request: Request, context: Context) {
  await ready;
  const { path } = await context.params;
  try {
    if (path[0] === "health") {
      const [dbNow] = await sql`SELECT now()`,
        [worker] =
          await sql`SELECT * FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1`;
      const age = worker
        ? Date.now() - new Date(worker.last_seen_at).getTime()
        : Infinity;
      return json({
        status: dbNow && age < 30_000 ? "ready" : "degraded",
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
        ? await sql`SELECT s.*,row_to_json(v.*) version FROM skills s LEFT JOIN skill_versions v ON v.id=s.active_version_id WHERE s.id=${skillId}`
        : await sql`SELECT s.*,row_to_json(v.*) version FROM skills s LEFT JOIN skill_versions v ON v.id=s.active_version_id ORDER BY s.updated_at DESC LIMIT 1`;
      if (!skill) return json(null);
      return json(skill);
    }
    if (path[0] === "skills" && path.length === 1) {
      const skills =
        await sql`SELECT s.*,v.version active_version,v.description FROM skills s LEFT JOIN skill_versions v ON v.id=s.active_version_id ORDER BY s.updated_at DESC,s.name`;
      return json(skills);
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
      const bytes = await readFile(store.path(key));
      return new Response(bytes, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${version.name}-v${version.version}.zip"`,
        },
      });
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
        await sql`SELECT id,status,baseline,iterations,job_id,created_at,started_at,completed_at,eval_version_id FROM runs WHERE id=${path[1]}`;
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
          cases.map((item) => String(item.case_id)),
          events as any,
          results as any,
        ),
      );
    }
    if (path[0] === "runs" && path[1] && path[2] === "download") {
      const [run] =
        await sql`SELECT raw_report_key FROM runs WHERE id=${path[1]} AND status='completed'`;
      if (!run?.raw_report_key)
        return fail(
          "NOT_READY",
          "Report is not ready",
          "The run has no completed raw report bundle.",
          409,
        );
      const bytes = await readFile(store.path(run.raw_report_key));
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
        skillPatch = (await readFile(store.path(p.skill_patch_key))).toString(
          "utf8",
        );
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
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          let cursor = last,
            closed = false;
          const close = () => {
            if (!closed) {
              closed = true;
              controller.close();
            }
          };
          request.signal.addEventListener("abort", close);
          for (let cycles = 0; cycles < 600 && !closed; cycles++) {
            const events =
              await sql`SELECT sequence,type,data,occurred_at FROM job_events WHERE job_id=${jobId} AND sequence>${cursor} ORDER BY sequence`;
            for (const event of events) {
              cursor = Number(event.sequence);
              controller.enqueue(
                encoder.encode(
                  `id: ${cursor}\ndata: ${JSON.stringify({ id: cursor, jobId, type: event.type, occurredAt: new Date(event.occurred_at).toISOString(), data: event.data })}\n\n`,
                ),
              );
              if (event.type === "completed" || event.type === "failed") {
                close();
                return;
              }
            }
            await new Promise((r) => setTimeout(r, 500));
          }
          close();
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
  await ready;
  const { path } = await context.params;
  try {
    if (path[0] === "skill" && path[1] === "upload") {
      const upload = await multipart(request);
      try {
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
        const [existingSkill] =
          await sql`SELECT * FROM skills WHERE name=${metadata.name}`;
        const [duplicate] =
          await sql`SELECT * FROM skill_versions WHERE checksum=${inspected.checksum}`;
        if (duplicate) {
          const [existingEval] =
            await sql`SELECT id FROM eval_versions WHERE skill_version_id=${duplicate.id} ORDER BY created_at DESC LIMIT 1`;
          return json(
            {
              jobId: null,
              resourceId: duplicate.id,
              skillId: duplicate.skill_id,
              evalId: existingEval?.id,
              identical: true,
            },
            200,
          );
        }
        const skillId = existingSkill?.id ?? crypto.randomUUID();
        if (!existingSkill)
          await sql`INSERT INTO skills(id,name) VALUES(${skillId},${metadata.name})`;
        const versionRows =
          await sql`SELECT COALESCE(max(version),0)+1 next FROM skill_versions WHERE skill_id=${skillId}`;
        const next = versionRows[0]?.next;
        if (!next) throw new Error("Could not allocate Skill version");
        const versionId = crypto.randomUUID();
        const originalKey = `skill-versions/${versionId}/original.zip`,
          installableKey = `skill-versions/${versionId}/installable.zip`;
        await store.put(originalKey, await readFile(zip.path));
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
        await store.put(installableKey, await readFile(installablePath));
        const manifest = {
          entries: included.map((p) => ({
            path: root ? relative(root, p) : p,
            size: inspected.entries.find((e) => e.path === p)?.size ?? 0,
          })),
          excluded: inspected.entries
            .filter((e) => excluded(e.path))
            .map((e) => e.path),
        };
        await sql`INSERT INTO skill_versions(id,skill_id,version,name,description,selected_root,root_candidates,manifest,readiness,status,checksum,original_key,installable_key) VALUES(${versionId},${skillId},${Number(next)},${metadata.name},${metadata.description},${root},${sql.json(inspected.roots)},${sql.json(manifest)},${sql.json({ ready: true, findings: [], runtimes: ["node24", "python3.12", "go1.25"] })},'ready',${inspected.checksum},${originalKey},${installableKey})`;
        await sql`UPDATE skills SET active_version_id=${versionId},updated_at=now() WHERE id=${skillId}`;
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
          await store.put(key, await readFile(file.path));
          await sql`INSERT INTO eval_files(eval_version_id,kind,filename,artifact_key,metadata) VALUES(${evalId},${upload.fields[`kind:${file.filename}`] ?? "dataset"},${file.filename},${key},${sql.json({ mime: file.mime })})`;
        }
        return json(
          {
            jobId: null,
            resourceId: versionId,
            skillId,
            evalId,
            identical: false,
          },
          201,
        );
      } finally {
        await rm(upload.directory, { recursive: true, force: true });
      }
    }
    if (path[0] === "evals" && path[1] && path[2] === "author") {
      const evalId = path[1];
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
      await sql.begin(async (tx) => {
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
    if (path[0] === "evals" && path[1] && path[2] === "approve-plan") {
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
      const [row] =
        await sql`UPDATE eval_versions SET status='generating',validation='{}' WHERE id=${path[1]} AND status IN ('failed','generating') RETURNING id`;
      if (!row)
        return fail(
          "INVALID_TRANSITION",
          "Eval cannot be retried",
          "Only a failed generation can be retried.",
          409,
        );
      const jobId = await enqueue(sql, "eval_generate", path[1], {
        retry: true,
      });
      return json({ jobId, resourceId: path[1] }, 202);
    }
    if (path[0] === "evals" && path[1] && path[2] === "approve") {
      const [row] =
        await sql`UPDATE eval_versions target SET status='approved',version=(SELECT COALESCE(max(other.version),0)+1 FROM eval_versions other JOIN skill_versions other_sv ON other_sv.id=other.skill_version_id WHERE other.version IS NOT NULL AND other_sv.skill_id=(SELECT target_sv.skill_id FROM skill_versions target_sv WHERE target_sv.id=target.skill_version_id)),approved_at=now() WHERE target.id=${path[1]} AND target.status='ready' AND (target.validation->>'valid')::boolean=true RETURNING target.id`;
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
        await sql`SELECT checksum FROM skill_versions WHERE id=${input.skillVersionId}`;
      const [ev] =
        await sql`SELECT checksum,status FROM eval_versions WHERE id=${input.evalVersionId}`;
      if (!sv || !ev || ev.status !== "approved")
        return fail(
          "NOT_READY",
          "Approved eval and Skill required",
          "Approve the eval before launching.",
          409,
        );
      const runId = crypto.randomUUID();
      await sql`INSERT INTO runs(id,skill_version_id,eval_version_id,model,settings,skill_checksum,eval_checksum,baseline,iterations) VALUES(${runId},${input.skillVersionId},${input.evalVersionId},${input.model},${sql.json({ parallelism: 1, retries: { correctness: 0, transient: 1 }, environment: "none" })},${sv.checksum},${ev.checksum},${input.baseline},${input.iterations})`;
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
      await sql.begin(async (tx) => {
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
        candidateManifest: any;
      try {
        const inspected = await extractZip(
          store.path(p.installable_key),
          candidateWork,
        );
        const skillRoot = resolve(candidateWork, p.selected_root);
        if (
          relative(candidateWork, skillRoot).startsWith("..") ||
          /(^|\/)\.\.(\/|$)/.test(p.selected_root)
        )
          throw new Error("Unsafe Skill root");
        for (const change of p.skill_changes as Array<Record<string, any>>) {
          const changePath = canonicalSkillChangePath(
            String(change.path ?? ""),
            p.selected_root,
          );
          const target = resolve(skillRoot, changePath);
          const rel = relative(skillRoot, target);
          if (
            !changePath ||
            rel.startsWith("..") ||
            resolve(target) === resolve(skillRoot) ||
            typeof change.content !== "string" ||
            Buffer.byteLength(change.content) > 1_000_000
          )
            throw new Error(`Unsafe Skill change path: ${changePath}`);
          if (change.action !== "replace" && change.action !== "create")
            throw new Error(
              `Unsupported Skill change action: ${change.action}`,
            );
          if (change.action === "replace") await readFile(target);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, change.content);
        }
        const output = join(candidateWork, "candidate.zip");
        const entries = [
          ...inspected.entries
            .filter(
              (entry) => !entry.directory && entry.path !== "candidate.zip",
            )
            .map((entry) => entry.path),
          ...(p.skill_changes as Array<Record<string, any>>)
            .filter((change) => change.action === "create")
            .map((change) =>
              p.selected_root
                ? `${p.selected_root}/${change.path}`
                : String(change.path),
            ),
        ].filter((value, index, all) => all.indexOf(value) === index);
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
        candidateKey = `skill-versions/${candidate}/installable.zip`;
        await store.put(candidateKey, bytes);
      } finally {
        await rm(candidateWork, { recursive: true, force: true });
      }
      await sql`INSERT INTO skill_versions(id,skill_id,version,name,description,selected_root,root_candidates,manifest,readiness,status,checksum,original_key,installable_key,base_version_id) VALUES(${candidate},${p.skill_id},${Number(next)},${p.name},${p.description},${p.selected_root},${sql.json(p.root_candidates)},${sql.json(candidateManifest!)},${sql.json(p.readiness)},'candidate',${candidateChecksum!},${candidateKey!},${candidateKey!},${p.base_version_id})`;
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
        const evalWork = await mkdtemp(
          join(tmpdir(), "skilled-eval-candidate-"),
        );
        try {
          const inspectedEval = await extractZip(
            store.path(sourceEval.bundle_key),
            evalWork,
            { requireSkill: false },
          );
          const sourceCases =
            await sql`SELECT * FROM eval_cases WHERE eval_version_id=${p.eval_version_id} ORDER BY case_id`;
          const changes = new Map(
            (p.eval_changes as Array<Record<string, any>>).map((change) => [
              change.caseId,
              change,
            ]),
          );
          const manifestPath = resolve(evalWork, "evals/skilled.manifest.json");
          const derivedManifest = JSON.parse(
            await readFile(manifestPath, "utf8"),
          );
          for (const sourceCase of sourceCases) {
            const change = changes.get(sourceCase.case_id);
            if (!change) continue;
            const yamlFile = resolve(evalWork, sourceCase.yaml_path);
            if (relative(evalWork, yamlFile).startsWith(".."))
              throw new Error("Unsafe eval case path");
            const spec = JSON.parse(await readFile(yamlFile, "utf8"));
            if (change.prompt) spec.input.prompt = String(change.prompt);
            if (change.criteria) {
              spec.judge.criteria = change.criteria;
              derivedManifest.cases[sourceCase.case_id].assertions =
                Object.fromEntries(
                  (change.criteria as string[]).map((criterion, index) => [
                    criterion,
                    {
                      dimension:
                        sourceCase.required_dimensions[index] ??
                        sourceCase.required_dimensions[0],
                      required: true,
                    },
                  ]),
                );
            }
            await writeFile(yamlFile, JSON.stringify(spec, null, 2));
          }
          await writeFile(
            manifestPath,
            JSON.stringify(derivedManifest, null, 2),
          );
          const bundle = join(evalWork, "derived-bundle.zip");
          await createZip(
            evalWork,
            inspectedEval.entries
              .filter((entry) => !entry.directory)
              .map((entry) => entry.path),
            bundle,
          );
          const bytes = await readFile(bundle);
          const bundleKey = `eval-versions/${verificationEvalId}/bundle.zip`;
          await store.put(bundleKey, bytes);
          await sql`INSERT INTO eval_versions(id,skill_version_id,version,revision,status,evidence_level,task_understanding,coverage_plan,answers,questions,generation_notes,bundle_key,checksum,validation,approved_at) VALUES(${verificationEvalId},${p.base_version_id},${Number(nextEvalRows[0]?.next ?? 1)},1,'approved',${sourceEval.evidence_level},${sql.json(sourceEval.task_understanding)},${sql.json(sourceEval.coverage_plan)},${sql.json(sourceEval.answers)},${sql.json(sourceEval.questions)},${sql.json(sourceEval.generation_notes)},${bundleKey},${sha256(bytes)},${sql.json({ valid: true, derivedFrom: p.eval_version_id, proposalId: p.proposal_id })},now())`;
          await sql`INSERT INTO eval_files(eval_version_id,kind,filename,artifact_key,metadata) SELECT ${verificationEvalId},kind,filename,artifact_key,metadata FROM eval_files WHERE eval_version_id=${p.eval_version_id}`;
          for (const sourceCase of sourceCases) {
            const change = changes.get(sourceCase.case_id);
            const source = { ...sourceCase.source };
            let mapping = sourceCase.assertion_mapping;
            if (change?.prompt) source.prompt = String(change.prompt);
            if (change?.criteria) {
              source.criteria = change.criteria;
              mapping = Object.fromEntries(
                (change.criteria as string[]).map((criterion, index) => [
                  criterion,
                  {
                    dimension:
                      sourceCase.required_dimensions[index] ??
                      sourceCase.required_dimensions[0],
                    required: true,
                  },
                ]),
              );
            }
            await sql`INSERT INTO eval_cases(eval_version_id,case_id,title,coverage_group,enabled,judge_type,evidence_provenance,required_dimensions,yaml_path,assertion_mapping,source) VALUES(${verificationEvalId},${sourceCase.case_id},${sourceCase.title},${sourceCase.coverage_group},${sourceCase.enabled},${sourceCase.judge_type},${sql.json(sourceCase.evidence_provenance)},${sql.json(sourceCase.required_dimensions)},${sourceCase.yaml_path},${sql.json(mapping)},${sql.json(source)})`;
          }
        } finally {
          await rm(evalWork, { recursive: true, force: true });
        }
      }
      await sql`UPDATE update_proposals SET status='candidate_created',skill_decision='approved',eval_decision=${input.evalDecision},candidate_version_id=${candidate},eval_version_id=${verificationEvalId},updated_at=now() WHERE id=${p.proposal_id}`;
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
        await sql`SELECT * FROM update_proposals WHERE id=${path[1]} AND status='candidate_created'`;
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
        await sql`SELECT checksum FROM eval_versions WHERE id=${p.eval_version_id}`;
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
      };
      for (const [id, version, checksum] of [
        [currentRun, p.base_version_id, base.checksum],
        [candidateRun, p.candidate_version_id, candidate.checksum],
      ])
        await sql`INSERT INTO runs(id,skill_version_id,eval_version_id,model,settings,skill_checksum,eval_checksum,iterations,status) VALUES(${id},${version},${p.eval_version_id},'gpt-5.6-luna',${sql.json(settings)},${checksum},${ev.checksum},1,'queued')`;
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
      const [p] =
        await sql`SELECT p.*,sv.skill_id FROM update_proposals p JOIN skill_versions sv ON sv.id=p.candidate_version_id WHERE p.id=${path[1]} AND p.status='verified'`;
      if (!p)
        return fail(
          "BLOCKED",
          "Candidate cannot be activated",
          "Verification must finish without blocking regressions.",
          409,
        );
      await sql.begin(async (tx) => {
        await tx`UPDATE skills SET active_version_id=${p.candidate_version_id},updated_at=now() WHERE id=${p.skill_id}`;
        await tx`UPDATE skill_versions SET status='ready' WHERE id=${p.candidate_version_id}`;
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
  await ready;
  const { path } = await context.params;
  try {
    if (path[0] === "evals" && path[1] && path[2] === "cases" && path[3]) {
      const body = (await request.json()) as {
        enabled?: boolean;
        source?: unknown;
      };
      const enabled = body.enabled ?? null;
      const source =
        body.source === undefined ? null : sql.json(body.source as never);
      const [row] =
        await sql`UPDATE eval_cases SET enabled=COALESCE(${enabled},enabled),source=COALESCE(${source},source) WHERE eval_version_id=${path[1]} AND case_id=${path[3]} RETURNING *`;
      if (!row) return fail("NOT_FOUND", "Case not found", "", 404);
      await sql`UPDATE eval_versions SET revision=revision+1,status=CASE WHEN status='approved' THEN status ELSE 'generating' END,validation='{}' WHERE id=${path[1]}`;
      return json(row);
    }
    return fail("NOT_FOUND", "Endpoint not found", "", 404);
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
