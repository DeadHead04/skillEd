import test from "node:test";
import assert from "node:assert/strict";
import { db, migrate, closeDatabases } from "@skilled/core";
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
      const api = await import("../app/api/v1/[...path]/route");
      const [skill] =
        await sql`INSERT INTO skills(name) VALUES('api-test') RETURNING id`;
      const [v] =
        await sql`INSERT INTO skill_versions(skill_id,version,name,selected_root,checksum,original_key) VALUES(${skill!.id},1,'api-test','','source','source.zip') RETURNING id`;
      const [ev] =
        await sql`INSERT INTO eval_versions(skill_version_id,status,checksum,validation) VALUES(${v!.id},'ready','eval','{"valid":true}') RETURNING id,revision`;
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
      const key = crypto.randomUUID();
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
      // Route pools are short-lived test-process resources, and the schema is isolated.
    } finally {
      await sql.end();
      await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
      await closeDatabases();
    }
  },
);
