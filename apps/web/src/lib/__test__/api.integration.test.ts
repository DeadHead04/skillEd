import test from "node:test";
import assert from "node:assert/strict";
import {
  db,
  migrate,
  closeDatabases,
  NORMALIZATION_VERSION,
  profileHash,
  CoveragePlanSchema,
} from "@skilled/core";
const url = process.env.SKILLED_TEST_DATABASE_URL;
test(
  "actual API routes enforce idempotent launch, immutable approvals and stale revisions",
  { skip: !url },
  async () => {
    if (!new URL(url!).pathname.includes("skilled_test"))
      throw new Error("Use a disposable skilled_test database");
    const admin = db(url);
    const schema = `api_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    const testUrl = new URL(url!);
    testUrl.searchParams.set("search_path", `${schema},public`);
    process.env.DATABASE_URL = testUrl.toString();
    process.env.SKILLED_ADAPTER_MODE = "fake";
    const sql = db();
    try {
      assert.equal(
        (await sql`SELECT current_schema() value`)[0]!.value,
        schema,
      );
      await migrate(sql);
      const api = await import("../../app/api/v1/[...path]/route");
      const [skill] =
        await sql`INSERT INTO skills(name) VALUES('api-test') RETURNING id`;
      const [v] =
        await sql`INSERT INTO skill_versions(skill_id,version,name,selected_root,checksum,original_key) VALUES(${skill!.id},1,'api-test','','source','source.zip') RETURNING id`;
      const [ev] =
        await sql`INSERT INTO eval_versions(skill_version_id,status,checksum,validation,profile_hash) VALUES(${v!.id},'ready','eval','{"valid":true}','approved-profile-fixture') RETURNING id,revision`;
      await sql`INSERT INTO eval_cases(eval_version_id,case_id,title,coverage_group,judge_type,required_dimensions,yaml_path) VALUES(${ev!.id},'CASE','Case','group','script','["correctness"]','case.yaml')`;
      const send = (
        parts: string[],
        body: unknown,
        key = crypto.randomUUID(),
      ) =>
        api.POST(
          new Request("http://localhost/api/v1/" + parts.join("/"), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": key,
            },
            body: JSON.stringify(body),
          }),
          { params: Promise.resolve({ path: parts }) },
        );
      const [failedAuthorEval] =
        await sql`INSERT INTO eval_versions(skill_version_id,status) VALUES(${v!.id},'failed') RETURNING id`;
      await sql`INSERT INTO jobs(type,resource_id,status,payload,adapter,error,completed_at) VALUES('eval_author',${failedAuthorEval!.id},'failed','{"phase":"initial"}','real','{"code":"WORKER_FAILURE"}',now())`;
      const retriedAuthor = await send(
        ["evals", failedAuthorEval!.id, "retry"],
        {},
      );
      assert.equal(retriedAuthor.status, 202);
      const retriedAuthorBody = await retriedAuthor.json();
      const [retriedAuthorJob] =
        await sql`SELECT type,payload FROM jobs WHERE id=${retriedAuthorBody.jobId}`;
      assert.equal(retriedAuthorJob!.type, "eval_author");
      assert.deepEqual(retriedAuthorJob!.payload, {
        phase: "initial",
        retry: true,
      });
      assert.equal(
        (
          await sql`SELECT status FROM eval_versions WHERE id=${failedAuthorEval!.id}`
        )[0]!.status,
        "understanding",
      );
      await sql`DELETE FROM jobs WHERE resource_id=${failedAuthorEval!.id}`;
      await sql`DELETE FROM eval_versions WHERE id=${failedAuthorEval!.id}`;
      const emptyStream = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
      const emptyRequest = new Request("http://localhost/api/v1/not-a-route", {
        method: "POST",
        body: emptyStream,
        duplex: "half",
      } as RequestInit);
      assert.equal(
        (
          await api.POST(emptyRequest, {
            params: Promise.resolve({ path: ["not-a-route"] }),
          })
        ).status,
        404,
      );
      const oversized = await send(["runs", "launch"], {
        text: "x".repeat(1_000_001),
      });
      assert.equal(oversized.status, 413);
      const wrongType = await api.POST(
        new Request("http://localhost/api/v1/runs/launch", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        }),
        { params: Promise.resolve({ path: ["runs", "launch"] }) },
      );
      assert.equal(wrongType.status, 415);
      const stale = await send(["evals", ev!.id, "approve"], {
        expectedRevision: 100,
      });
      assert.equal(stale.status, 409);
      const approved = await send(["evals", ev!.id, "approve"], {
        expectedRevision: 1,
      });
      assert.equal(approved.status, 200);
      const edited = await api.PATCH(
        new Request("http://localhost/api/v1/evals/" + ev!.id + "/cases/CASE", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: false, expectedRevision: 1 }),
        }),
        {
          params: Promise.resolve({ path: ["evals", ev!.id, "cases", "CASE"] }),
        },
      );
      assert.equal(edited.status, 409);
      const payload = {
        skillVersionId: v!.id,
        evalVersionId: ev!.id,
        selectedCaseIds: ["CASE"],
        iterations: 3,
        baseline: true,
      };
      // A failed prerequisite must not create jobs, mutate the draft, or get
      // cached as an idempotent success. Repairing readiness permits a retry.
      process.env.SKILLED_ADAPTER_MODE = "real";
      const retryKey = crypto.randomUUID();
      await sql`INSERT INTO worker_heartbeats(worker_id,readiness,last_seen_at) VALUES('readiness-test','{"execution":"blocked","code":"ACCEPTANCE_MISSING","detail":"Missing measured acceptance report"}',now())`;
      for (const parts of [
        ["runs", "launch"],
        ["evals", ev!.id, "retry"],
        ["evals", ev!.id, "author"],
        ["evals", ev!.id, "approve-plan"],
        ["updates", "generate"],
      ]) {
        const blocked = await send(
          parts,
          payload,
          parts[0] === "runs" ? retryKey : crypto.randomUUID(),
        );
        assert.equal(blocked.status, 503);
        const problem = await blocked.json();
        assert.equal(problem.code, "EXECUTION_UNAVAILABLE");
        assert.equal(problem.retryable, false);
        assert.match(problem.detail, /Missing measured acceptance/);
      }
      assert.equal(Number((await sql`SELECT count(*) FROM jobs`)[0]!.count), 0);
      assert.equal(
        (await sql`SELECT status FROM eval_versions WHERE id=${ev!.id}`)[0]!
          .status,
        "approved",
      );
      await sql`UPDATE worker_heartbeats SET readiness='{"execution":"ready"}',last_seen_at=now()-interval '1 minute' WHERE worker_id='readiness-test'`;
      const staleReadiness = await send(["runs", "launch"], payload, retryKey);
      assert.equal(staleReadiness.status, 503);
      assert.match((await staleReadiness.json()).detail, /heartbeat is stale/);
      const fresh = await api.GET(
        new Request("http://localhost/api/v1/execution-readiness"),
        { params: Promise.resolve({ path: ["execution-readiness"] }) },
      );
      assert.equal((await fresh.json()).available, false);
      await sql`UPDATE worker_heartbeats SET readiness='{"execution":"ready"}',last_seen_at=now() WHERE worker_id='readiness-test'`;
      const available = await api.GET(
        new Request("http://localhost/api/v1/execution-readiness"),
        { params: Promise.resolve({ path: ["execution-readiness"] }) },
      );
      assert.equal((await available.json()).available, true);
      process.env.SKILLED_ADAPTER_MODE = "fake";
      const key = retryKey;
      const replies = await Promise.all([
        send(["runs", "launch"], payload, key),
        send(["runs", "launch"], payload, key),
      ]);
      assert.deepEqual(
        replies.map((r) => r.status),
        [202, 202],
      );
      assert.deepEqual(await replies[0]!.json(), await replies[1]!.json());
      assert.equal(Number((await sql`SELECT count(*) FROM runs`)[0]!.count), 1);
      assert.equal(Number((await sql`SELECT count(*) FROM jobs`)[0]!.count), 1);
      assert.equal(
        (await sql`SELECT settings FROM runs`)[0]!.settings.profileHash,
        "approved-profile-fixture",
      );
      const [blockedVersion] =
        await sql`INSERT INTO skill_versions(skill_id,version,name,selected_root,checksum,original_key,package_assessment) VALUES(${skill!.id},99,'blocked-runtime','','blocked','blocked.zip','{"valid":true,"runtime":"unsupported"}') RETURNING id`;
      const blockedPackage = await send(["runs", "launch"], {
        ...payload,
        skillVersionId: blockedVersion!.id,
      });
      assert.equal(blockedPackage.status, 409);
      assert.equal((await blockedPackage.json()).code, "PACKAGE_BLOCKED");
      assert.equal(Number((await sql`SELECT count(*) FROM runs`)[0]!.count), 1);
      assert.equal(
        (await send(["runs", "launch"], { ...payload, iterations: 1 }, key))
          .status,
        409,
      );
      assert.equal(
        (
          await send(["runs", "launch"], {
            ...payload,
            selectedCaseIds: ["MISSING"],
          })
        ).status,
        400,
      );
      assert.equal(Number((await sql`SELECT count(*) FROM runs`)[0]!.count), 1);
      const [candidate] =
        await sql`INSERT INTO skill_versions(skill_id,version,name,selected_root,checksum,original_key) VALUES(${skill!.id},2,'candidate','','candidate','candidate.zip') RETURNING id`;
      const [verification] =
        await sql`INSERT INTO runs(skill_version_id,eval_version_id,status,model,settings,skill_checksum,eval_checksum,provenance_status,engine_versions) VALUES(${candidate!.id},${ev!.id},'completed','demo','{}','candidate','eval','verified_pipeline','{"adapter":"demo"}') RETURNING id`;
      const [proposal] =
        await sql`INSERT INTO update_proposals(source_run_id,base_version_id,eval_version_id,candidate_version_id,candidate_verification_run_id,status,skill_decision) VALUES(${verification!.id},${v!.id},${ev!.id},${candidate!.id},${verification!.id},'verified','approve') RETURNING id`;
      const activated = await send(["updates", proposal!.id, "activate"], {});
      assert.equal(activated.status, 200, await activated.text());
      assert.equal(
        (await send(["updates", proposal!.id, "activate"], {})).status,
        200,
      );
      assert.equal(
        Number(
          (
            await sql`SELECT count(*) FROM decision_records WHERE resource_id=${proposal!.id} AND action='activate'`
          )[0]!.count,
        ),
        1,
      );
      const [other] =
        await sql`INSERT INTO skill_versions(skill_id,version,name,selected_root,checksum,original_key) VALUES(${skill!.id},3,'other','','other','other.zip') RETURNING id`;
      await sql`UPDATE skills SET active_version_id=${other!.id} WHERE id=${skill!.id}`;
      assert.equal(
        (await send(["updates", proposal!.id, "activate"], {})).status,
        409,
      );
      await assert.rejects(
        sql`UPDATE update_proposals SET summary='{"changed":true}' WHERE id=${proposal!.id}`,
      );
      const [firstSkill] =
        await sql`INSERT INTO skills(name) VALUES('initial-verification') RETURNING id`;
      const assessment = {
        schemaVersion: "skilled-package-assessment-v1",
        packageHash: "initial",
        provenance: "static-analysis",
        valid: true,
        runtime: "not_checked",
        findings: [],
        references: [],
      };
      const [firstVersion] =
        await sql`INSERT INTO skill_versions(skill_id,version,name,selected_root,checksum,original_key,package_assessment) VALUES(${firstSkill!.id},1,'initial-verification','','initial','initial.zip',${sql.json(assessment)}) RETURNING id`;
      const [firstEval] =
        await sql`INSERT INTO eval_versions(skill_version_id,status,checksum,validation) VALUES(${firstVersion!.id},'ready','initial-eval','{"valid":true}') RETURNING id`;
      const mapping = {
        "FIRST-result": {
          id: "FIRST-result",
          areaId: "task-outcome",
          role: "task_success",
          required: true,
        },
      };
      await sql`INSERT INTO eval_cases(eval_version_id,case_id,title,coverage_group,judge_type,required_dimensions,yaml_path,assertion_mapping) VALUES(${firstEval!.id},'FIRST','Initial output','Core','script','["task-outcome"]','first.yaml',${sql.json(mapping)})`;
      await sql`UPDATE eval_versions SET status='approved' WHERE id=${firstEval!.id}`;
      const [firstRun] =
        await sql`INSERT INTO runs(skill_version_id,eval_version_id,status,model,settings,skill_checksum,eval_checksum,iterations,baseline,provenance_status,engine_versions) VALUES(${firstVersion!.id},${firstEval!.id},'running','demo','{}','initial','initial-eval',3,false,'verified_pipeline',${sql.json({ adapter: "demo", normalizationVersion: NORMALIZATION_VERSION })}) RETURNING id`;
      for (const iteration of [1, 2, 3])
        await sql`INSERT INTO case_results(run_id,case_id,configuration,iteration,result,assertions) VALUES(${firstRun!.id},'FIRST','skill',${iteration},'PASS',${sql.json([{ id: "FIRST-result", passed: true }])})`;
      await sql`UPDATE runs SET status='finalizing' WHERE id=${firstRun!.id}`;
      await sql`UPDATE runs SET status='completed' WHERE id=${firstRun!.id}`;
      const initialDecision = {
        runId: firstRun!.id,
        expectedActiveVersionId: null,
      };
      const initialReplies = await Promise.all([
        send(
          ["skill", "versions", firstVersion!.id, "activate-initial"],
          initialDecision,
        ),
        send(
          ["skill", "versions", firstVersion!.id, "activate-initial"],
          initialDecision,
        ),
      ]);
      assert.deepEqual(
        initialReplies.map((r) => r.status),
        [200, 200],
      );
      assert.equal(
        Number(
          (
            await sql`SELECT count(*) FROM decision_records WHERE resource_id=${firstVersion!.id} AND action='initial_activation'`
          )[0]!.count,
        ),
        1,
      );
      const [secondVersion] =
        await sql`INSERT INTO skill_versions(skill_id,version,name,selected_root,checksum,original_key,package_assessment) VALUES(${firstSkill!.id},2,'initial-verification','','initial-2','initial-2.zip',${sql.json(assessment)}) RETURNING id`;
      assert.equal(
        (
          await send(
            ["skill", "versions", secondVersion!.id, "activate-initial"],
            initialDecision,
          )
        ).status,
        409,
      );
      const plan = CoveragePlanSchema.parse({
        areas: [
          {
            id: "task-outcome",
            label: "Task outcome",
            description: "Output matches the task",
            role: "task_success",
            required: true,
            sourceReferences: [],
          },
        ],
        groups: [
          {
            name: "Core",
            purpose: "Check output",
            caseCount: 1,
            judge: "agent",
            dimensions: ["task-outcome"],
            provenance: ["task"],
            iterations: 1,
          },
        ],
      });
      const understanding = {
        inputs: ["task"],
        outputs: ["result"],
        authorities: [],
        invariants: [],
        allowedChanges: [],
        dependencies: ["none"],
        ambiguity: [],
        likelyHallucinations: [],
        failureModes: [],
      };
      const [profileDraft] =
        await sql`INSERT INTO eval_versions(skill_version_id,status,coverage_plan,task_understanding) VALUES(${secondVersion!.id},'awaiting_plan_approval',${sql.json(plan)},${sql.json(understanding)}) RETURNING id`;
      assert.equal(
        (
          await send(["evals", profileDraft!.id, "approve-plan"], {
            expectedRevision: 1,
            profileHash: "wrong",
          })
        ).status,
        409,
      );
      const approval = {
        expectedRevision: 1,
        profileHash: profileHash(plan, understanding),
      };
      assert.equal(
        (await send(["evals", profileDraft!.id, "approve-plan"], approval))
          .status,
        202,
      );
      assert.equal(
        (await send(["evals", profileDraft!.id, "approve-plan"], approval))
          .status,
        409,
      );
      assert.equal(
        Number(
          (
            await sql`SELECT count(*) FROM decision_records WHERE resource_id=${profileDraft!.id} AND action='approve_profile'`
          )[0]!.count,
        ),
        1,
      );
      const { currentEval } = await import("../data");
      assert.equal(
        (await currentEval(undefined, firstSkill!.id, firstVersion!.id)).id,
        firstEval!.id,
      );
      assert.equal(
        (await currentEval(undefined, firstSkill!.id, secondVersion!.id)).id,
        profileDraft!.id,
      );
      // Route pools are short-lived test-process resources, and the schema is isolated.
      if (process.env.SKILLED_CONTRACT_CLI) {
        const { mkdtemp, readFile, rm } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const { tmpdir } = await import("node:os");
        const { ArtifactStore, extractZip } = await import("@skilled/core");
        // Keep the worker's Node types separate from Next's ambient ProcessEnv
        // augmentation. Its own project typechecks this entrypoint.
        const workerEntrypoint = "../../../worker/src/evals";
        const { generateEval } = await import(workerEntrypoint);
        const root = await mkdtemp(join(tmpdir(), "skilled-clone-bundle-"));
        process.env.ARTIFACT_ROOT = join(root, "artifacts");
        process.env.WORK_ROOT = join(root, "work");
        process.env.SKILL_UP_BIN = process.env.SKILLED_CONTRACT_CLI;
        try {
          const materialId = crypto.randomUUID();
          const plan = CoveragePlanSchema.parse({
            areas: [
              {
                id: "scope",
                label: "Input integrity",
                description: "Preserve input bytes",
                role: "task_success",
                required: true,
                sourceReferences: [{ materialId, location: "input" }],
              },
            ],
            groups: [
              {
                name: "fixtures",
                purpose: "Preserve input",
                caseCount: 1,
                judge: "script",
                dimensions: ["scope"],
                provenance: ["task"],
                iterations: 1,
              },
            ],
          });
          const definition = {
            id: "INPUT",
            title: "Input preservation",
            coverageGroup: "fixtures",
            purpose: "Preserve bytes",
            prompt: `Read inputs/${materialId}-input.json`,
            judgeType: "script",
            dimensions: ["scope"],
            criteria: ["Preserve input"],
            provenance: ["task"],
            sourceReferences: [{ materialId, location: "input" }],
            assertions: [
              {
                id: "keep",
                areaId: "scope",
                role: "task_success",
                required: true,
                text: "Preserve input",
              },
            ],
            deterministicChecks: [
              {
                assertionId: "keep",
                dimension: "scope",
                kind: "unchanged",
                format: "text",
                file: `inputs/${materialId}-input.json`,
                expectedMaterialId: materialId,
                allowedPaths: [],
              },
            ],
          };
          const [source] =
            await sql`INSERT INTO eval_versions(skill_version_id,status,checksum,coverage_plan) VALUES(${v!.id},'ready','original-frozen-bundle',${sql.json(plan)}) RETURNING id`;
          await sql`INSERT INTO eval_files(id,eval_version_id,kind,filename,artifact_key) VALUES(${materialId},${source!.id},'dataset','input.json','test/input.json')`;
          await sql`INSERT INTO eval_files(eval_version_id,kind,filename,artifact_key) VALUES(${source!.id},'expected','hidden.json','test/hidden.json')`;
          await sql`INSERT INTO eval_cases(eval_version_id,case_id,title,coverage_group,judge_type,required_dimensions,yaml_path,source) VALUES(${source!.id},'INPUT','Input preservation','fixtures','script','["scope"]','evals/cases/input.yaml',${sql.json(definition)})`;
          await sql`UPDATE eval_versions SET status='approved' WHERE id=${source!.id}`;
          const store = new ArtifactStore();
          await store.put("test/input.json", Buffer.from('{"value":1}\n'));
          await store.put("test/hidden.json", Buffer.from("hidden truth"));
          const cloneKey = crypto.randomUUID();
          const reply = await send(
            ["evals", source!.id, "clone"],
            { preserveCases: true },
            cloneKey,
          );
          assert.equal(reply.status, 201, await reply.clone().text());
          const { resourceId } = await reply.json();
          assert.equal(
            (
              await (
                await send(
                  ["evals", source!.id, "clone"],
                  { preserveCases: true },
                  cloneKey,
                )
              ).json()
            ).resourceId,
            resourceId,
          );
          const [copied] =
            await sql`SELECT * FROM eval_files WHERE eval_version_id=${resourceId} AND kind='dataset'`;
          assert.notEqual(copied!.id, materialId);
          const [job] =
            await sql`SELECT * FROM jobs WHERE resource_id=${resourceId}`;
          await generateEval(sql, job!);
          const [draft] =
            await sql`SELECT * FROM eval_versions WHERE id=${resourceId}`;
          assert.equal(draft!.status, "ready");
          assert.notEqual(draft!.checksum, "original-frozen-bundle");
          assert.equal(
            (
              await sql`SELECT checksum FROM eval_versions WHERE id=${source!.id}`
            )[0]!.checksum,
            "original-frozen-bundle",
          );
          const extracted = join(root, "extracted");
          await extractZip(
            await store.materialize(draft!.bundle_key),
            extracted,
            { requireSkill: false },
          );
          const spec = JSON.parse(
            await readFile(join(extracted, "evals/cases/input.yaml"), "utf8"),
          );
          // Match the pinned CLI's SkillDir-relative fixture resolution.
          assert.equal(
            await readFile(
              join(
                extracted,
                spec.context.repo_fixture,
                `inputs/${copied!.id}-input.json`,
              ),
              "utf8",
            ),
            '{"value":1}\n',
          );
          const manifest = JSON.parse(
            await readFile(
              join(extracted, "evals/skilled.manifest.json"),
              "utf8",
            ),
          );
          assert.equal(manifest.fixtures.length, 1);
          assert.equal(manifest.fixtures[0].id, copied!.id);
          const [clonedCase] =
            await sql`SELECT source FROM eval_cases WHERE eval_version_id=${resourceId}`;
          assert.equal(
            clonedCase!.source.deterministicChecks[0].file,
            `inputs/${copied!.id}-input.json`,
          );
          assert.equal(
            clonedCase!.source.deterministicChecks[0].expectedMaterialId,
            copied!.id,
          );
          const approvedHash = profileHash(
            draft!.coverage_plan,
            draft!.task_understanding,
          );
          const clonedApproval = await send(["evals", resourceId, "approve"], {
            expectedRevision: draft!.revision,
            profileHash: approvedHash,
          });
          assert.equal(
            clonedApproval.status,
            200,
            await clonedApproval.clone().text(),
          );
          assert.equal(
            (
              await sql`SELECT profile_hash FROM eval_versions WHERE id=${resourceId}`
            )[0]!.profile_hash,
            approvedHash,
          );
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    } finally {
      await sql.end();
      await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
      await closeDatabases();
    }
  },
);
