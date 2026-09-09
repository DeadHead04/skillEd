import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  db,
  migrate,
  enqueue,
  claimJob,
  recordDecision,
  type Db,
} from "@skilled/core";
import { runEvaluation } from "./runner.js";
import { fencedDatabase, reconcileJobs } from "./jobs.js";

const url = process.env.SKILLED_TEST_DATABASE_URL;
test(
  "PostgreSQL migration, immutable state, fenced execution and exact demo matrix",
  { skip: !url },
  async (t) => {
    if (!new URL(url!).pathname.includes("skilled_test"))
      throw new Error("Use a disposable skilled_test database");
    const admin = db(url);
    const schema = `test_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    const sql = db(url!, { search_path: `${schema},public` });
    const work = await mkdtemp(join(tmpdir(), "skilled-integration-"));
    process.env.ARTIFACT_ROOT = join(work, "artifacts");
    process.env.WORK_ROOT = join(work, "work");
    process.env.SKILLED_ADAPTER_MODE = "fake";
    try {
      // Upgrade a schema with actual historical records, then repeat the migration.
      await sql.unsafe(
        await readFile(
          new URL("../../../packages/core/src/schema.sql", import.meta.url),
          "utf8",
        ),
      );
      const [skill] =
        await sql`INSERT INTO skills(name) VALUES('migration-skill') RETURNING id`;
      const [version] =
        await sql`INSERT INTO skill_versions(skill_id,version,name,selected_root,checksum,original_key) VALUES(${skill!.id},1,'migration-skill','','original-checksum','test/source.zip') RETURNING id`;
      const [ev] =
        await sql`INSERT INTO eval_versions(skill_version_id,status,checksum,validation) VALUES(${version!.id},'ready','eval-checksum','{"valid":true}') RETURNING id`;
      const [history] =
        await sql`INSERT INTO runs(skill_version_id,eval_version_id,status,model,settings,skill_checksum,eval_checksum) VALUES(${version!.id},${ev!.id},'completed','historical','{}','original-checksum','eval-checksum') RETURNING id`;
      await migrate(sql);
      await migrate(sql);
      await t.test(
        "historical labels and IDs survive, and history cannot certify a candidate",
        async () => {
          const [run] = await sql`SELECT * FROM runs WHERE id=${history!.id}`;
          assert.equal(run!.status, "completed");
          assert.equal(run!.provenance_status, "legacy_unverified");
          assert.equal(
            (
              await sql`SELECT * FROM history_assessments WHERE resource_id=${history!.id}`
            ).length,
            1,
          );
          await assert.rejects(
            sql`UPDATE runs SET status='running' WHERE id=${history!.id}`,
          );
          await assert.rejects(
            sql`UPDATE skill_versions SET checksum='changed' WHERE id=${version!.id}`,
          );
        },
      );
      await t.test(
        "legacy original bytes can create one corrected normalized version without overwriting history",
        async () => {
          const [corrected] =
            await sql`INSERT INTO skill_versions(skill_id,version,name,selected_root,checksum,original_key,installable_key,installable_checksum,normalization_version) VALUES(${skill!.id},2,'migration-skill','','original-checksum','test/source.zip','test/normalized.zip','normalized-checksum','skilled-package-v2') RETURNING id`;
          assert.notEqual(corrected!.id, version!.id);
          await assert.rejects(
            sql`INSERT INTO skill_versions(skill_id,version,name,selected_root,checksum,original_key,installable_checksum,normalization_version) VALUES(${skill!.id},3,'migration-skill','','original-checksum','test/source.zip','normalized-checksum','skilled-package-v2')`,
          );
          assert.equal(
            (
              await sql`SELECT checksum FROM skill_versions WHERE id=${version!.id}`
            )[0]!.checksum,
            "original-checksum",
          );
        },
      );
      await t.test(
        "authoring follows the enforced lifecycle without skipping understanding",
        async () => {
          const { authorEval } = await import("./evals.js");
          const [draft] =
            await sql`INSERT INTO eval_versions(skill_version_id,status) VALUES(${version!.id},'collecting') RETURNING id`;
          await sql`INSERT INTO eval_files(eval_version_id,kind,filename) VALUES(${draft!.id},'expected','truth.json')`;
          await sql`INSERT INTO conversations(kind,resource_id) VALUES('eval_authoring',${draft!.id})`;
          const id = await enqueue(sql, "eval_author", draft!.id, {
            phase: "initial",
          });
          const job = await claimJob(sql, "author-fixture");
          assert.ok(job);
          await authorEval(fencedDatabase(sql, job), job);
          assert.equal(
            (
              await sql`SELECT status FROM eval_versions WHERE id=${draft!.id}`
            )[0]!.status,
            "awaiting_plan_approval",
          );
          await sql`UPDATE jobs SET status='completed' WHERE id=${id}`;
        },
      );
      for (const id of ["FG-001", "CASE-2"])
        await sql`INSERT INTO eval_cases(eval_version_id,case_id,title,coverage_group,judge_type,required_dimensions,yaml_path,assertion_mapping) VALUES(${ev!.id},${id},${id},'group','script','["correctness","scope"]','test.yaml',${sql.json({ correct: { id: `${id}-correctness`, dimension: "correctness", required: true }, scope: { id: `${id}-scope`, dimension: "scope", required: true } })})`;
      await sql`UPDATE eval_versions SET status='approved' WHERE id=${ev!.id}`;
      await t.test(
        "approved contents and decisions are immutable at the database boundary",
        async () => {
          await assert.rejects(
            sql`UPDATE eval_versions SET revision=2 WHERE id=${ev!.id}`,
          );
          await assert.rejects(
            sql`UPDATE eval_cases SET enabled=false WHERE eval_version_id=${ev!.id}`,
          );
          await assert.rejects(
            sql`INSERT INTO eval_files(eval_version_id,kind,filename) VALUES(${ev!.id},'dataset','late.csv')`,
          );
          await recordDecision(sql, null, ev!.id, "approve_eval", {
            revision: 1,
          });
          await assert.rejects(
            sql`DELETE FROM decision_records WHERE resource_id=${ev!.id}`,
          );
        },
      );
      const [run] =
        await sql`INSERT INTO runs(skill_version_id,eval_version_id,model,settings,skill_checksum,eval_checksum,iterations,baseline,provenance_status) VALUES(${version!.id},${ev!.id},'demo','{"selectedCaseIds":["FG-001"]}','original-checksum','eval-checksum',3,true,'verified_pipeline') RETURNING id`;
      const jobId = await enqueue(sql, "run", run!.id);
      const [a, b] = await Promise.all([
        claimJob(sql, "worker-a"),
        claimJob(sql, "worker-b"),
      ]);
      const job = a ?? b;
      assert.ok(job);
      assert.equal([a, b].filter(Boolean).length, 1);
      await t.test(
        "selected cases, baseline and repeated trials produce an exact matrix",
        async () => {
          await runEvaluation(fencedDatabase(sql, job), job);
          const rows =
            await sql`SELECT * FROM case_results WHERE run_id=${run!.id}`;
          assert.equal(rows.length, 6);
          assert.deepEqual(
            [...new Set(rows.map((r) => r.case_id))],
            ["FG-001"],
          );
          assert.deepEqual(
            [...new Set(rows.map((r) => r.configuration))].sort(),
            ["baseline", "skill"],
          );
          assert.equal(
            (await sql`SELECT status FROM runs WHERE id=${run!.id}`)[0]!.status,
            "completed",
          );
          assert.ok(rows.some((r) => r.result === "FAIL")); // Task failure is a completed execution.
        },
      );
      await t.test(
        "expired owners cannot write; recovery preserves completed evidence",
        async () => {
          await sql`UPDATE jobs SET lease_expires_at=now()-interval '1 second' WHERE id=${jobId}`;
          await assert.rejects(
            fencedDatabase(
              sql,
              job,
            )`INSERT INTO job_events(job_id,type) VALUES(${jobId},'stale')`,
            /lease lost/,
          );
          await reconcileJobs(sql);
          assert.equal(
            (await sql`SELECT status FROM jobs WHERE id=${jobId}`)[0]!.status,
            "interrupted",
          );
          assert.equal(
            (await sql`SELECT status FROM runs WHERE id=${run!.id}`)[0]!.status,
            "completed",
          );
        },
      );
      await t.test(
        "queued cancellation is terminal without dispatch",
        async () => {
          const id = await enqueue(sql, "noop", null);
          await sql`UPDATE jobs SET cancel_requested_at=now() WHERE id=${id}`;
          assert.equal(await claimJob(sql, "next"), null);
          await reconcileJobs(sql);
          assert.equal(
            (await sql`SELECT status FROM jobs WHERE id=${id}`)[0]!.status,
            "cancelled",
          );
        },
      );
    } finally {
      await sql.end();
      await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
      await rm(work, { recursive: true, force: true });
    }
  },
);

test(
  "full history export/import rehearsal preserves relationships and refuses corruption",
  { skip: !url },
  async () => {
    if (!new URL(url!).pathname.includes("skilled_test"))
      throw new Error("Use a disposable skilled_test database");
    const { exportHistory, importHistory } = await import(
      "../../../packages/core/src/history.js"
    );
    const { ArtifactStore, createZip, hashFile } = await import(
      "@skilled/core"
    );
    const admin = db(url);
    const id = crypto.randomUUID().replaceAll("-", "");
    const sourceSchema = `source_${id}`,
      destinationSchema = `destination_${id}`;
    await admin.unsafe(`CREATE SCHEMA ${sourceSchema}`);
    await admin.unsafe(`CREATE SCHEMA ${destinationSchema}`);
    const source = db(url!, { search_path: `${sourceSchema},public` });
    const destination = db(url!, {
      search_path: `${destinationSchema},public`,
    });
    const root = await mkdtemp(join(tmpdir(), "skilled-history-test-"));
    const sourceArtifacts = new ArtifactStore(join(root, "source"));
    const destinationArtifacts = new ArtifactStore(join(root, "destination"));
    try {
      await source.unsafe(
        await readFile(
          new URL("../../../packages/core/src/schema.sql", import.meta.url),
          "utf8",
        ),
      );
      await migrate(destination);
      const [skill] =
        await source`INSERT INTO skills(name) VALUES('preserved') RETURNING id`;
      await writeFile(join(root, "fixture.txt"), "fixture bytes");
      await createZip(root, ["fixture.txt"], join(root, "source.zip"));
      await sourceArtifacts.putFile(
        "skill/source.zip",
        join(root, "source.zip"),
      );
      const [v] =
        await source`INSERT INTO skill_versions(skill_id,version,name,selected_root,checksum,original_key,installable_key) VALUES(${skill!.id},1,'preserved','','source-hash','skill/source.zip','skill/source.zip') RETURNING id`;
      await source`UPDATE skills SET active_version_id=${v!.id} WHERE id=${skill!.id}`;
      const [e] =
        await source`INSERT INTO eval_versions(skill_version_id,status) VALUES(${v!.id},'approved') RETURNING id`;
      const [j] =
        await source`INSERT INTO jobs(type,status) VALUES('run','running') RETURNING id`;
      const [r] =
        await source`INSERT INTO runs(skill_version_id,eval_version_id,job_id,model,settings,skill_checksum,eval_checksum) VALUES(${v!.id},${e!.id},${j!.id},'fixture','{}','source-hash','eval-hash') RETURNING id`;
      await source`INSERT INTO case_results(run_id,case_id,iteration,result) VALUES(${r!.id},'CASE',1,'PARTIAL')`;
      await source`INSERT INTO users(login_id,display_name,role,password_hash) VALUES('admin','Administrator','administrator','synthetic-must-not-export')`;
      await source`INSERT INTO conversations(kind,resource_id,codex_thread_id) VALUES('eval_authoring',${e!.id},'native-thread-id')`;
      const backup = join(root, "backup");
      const exported = await exportHistory(source, sourceArtifacts, backup);
      assert.equal(exported.missing.length, 0);
      assert.ok(
        !(await readFile(join(backup, "history.json"), "utf8")).includes(
          "synthetic-must-not-export",
        ),
      );
      const imported = await importHistory(
        destination,
        destinationArtifacts,
        backup,
      );
      assert.equal(imported.repeated, false);
      assert.equal(
        (await importHistory(destination, destinationArtifacts, backup))
          .repeated,
        true,
      );
      assert.equal(
        (
          await destination`SELECT active_version_id FROM skills WHERE id=${skill!.id}`
        )[0]!.active_version_id,
        v!.id,
      );
      assert.equal(
        (await destination`SELECT status FROM runs WHERE id=${r!.id}`)[0]!
          .status,
        "interrupted",
      );
      assert.equal(
        (
          await destination`SELECT result FROM case_results WHERE run_id=${r!.id}`
        )[0]!.result,
        "PARTIAL",
      );
      assert.equal(
        (await destination`SELECT status FROM jobs WHERE id=${j!.id}`)[0]!
          .status,
        "interrupted",
      );
      assert.equal(
        (await destination`SELECT codex_thread_id FROM conversations`)[0]!
          .codex_thread_id,
        null,
      );
      assert.equal(
        await hashFile(destinationArtifacts.path("skill/source.zip")),
        await hashFile(join(root, "source.zip")),
      );
      assert.equal(
        (
          await destination`SELECT installable_checksum FROM skill_versions WHERE id=${v!.id}`
        )[0]!.installable_checksum,
        await hashFile(join(root, "source.zip")),
      );
      const { appendFile } = await import("node:fs/promises");
      await appendFile(join(backup, "history.json"), "corrupt");
      await assert.rejects(
        importHistory(destination, destinationArtifacts, backup),
        /checksum/,
      );
    } finally {
      await source.end();
      await destination.end();
      await admin.unsafe(
        `DROP SCHEMA ${sourceSchema},${destinationSchema} CASCADE`,
      );
      await admin.end();
      await rm(root, { recursive: true, force: true });
    }
  },
);
