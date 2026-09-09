import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ArtifactStore, hashFile, sha256 } from "./artifacts";
import { inspectZip } from "./archive";
import { type Db } from "./db";

const TABLES = [
  "users",
  "skills",
  "skill_versions",
  "eval_versions",
  "eval_files",
  "eval_cases",
  "conversations",
  "conversation_messages",
  "jobs",
  "job_events",
  "runs",
  "case_results",
  "update_proposals",
  "user_audit_events",
  "decision_records",
  "history_assessments",
] as const;
type Table = (typeof TABLES)[number];
type Snapshot = {
  schemaVersion: "skilled-history-v1";
  createdAt: string;
  tables: Record<Table, any[]>;
  artifacts: Array<{
    key: string;
    checksum?: string;
    size?: number;
    missing?: string;
  }>;
};
const artifactColumns = [
  "original_key",
  "installable_key",
  "artifact_key",
  "bundle_key",
  "raw_report_key",
  "normalized_key",
  "transcript_key",
  "skill_patch_key",
  "eval_patch_key",
];
function artifactKeys(tables: Snapshot["tables"]) {
  const keys = new Set<string>();
  for (const rows of Object.values(tables))
    for (const row of rows) {
      for (const column of artifactColumns)
        if (typeof row[column] === "string") keys.add(row[column]);
      for (const artifact of Array.isArray(row.artifacts) ? row.artifacts : [])
        if (typeof artifact.key === "string") keys.add(artifact.key);
    }
  return [...keys].sort();
}
function safeKey(key: string) {
  return !/(^|\/)(?:auth\.json|\.codex|\.auth|\.env[^/]*|credentials[^/]*)(\/|$)/i.test(
    key,
  );
}
export async function exportHistory(
  sql: Db,
  store: ArtifactStore,
  destination: string,
) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const tables = {} as Snapshot["tables"];
  await sql.begin("isolation level repeatable read read only", async (tx) => {
    for (const table of TABLES) {
      const [available] =
        await tx`SELECT to_regclass(format('%I.%I',current_schema(),${table}::text)) present`;
      if (
        !available?.present &&
        ["decision_records", "history_assessments"].includes(table)
      ) {
        tables[table] = [];
        continue;
      }
      if (!available?.present)
        throw new Error(`Missing source table: ${table}`);
      // Explicit projection excludes password hashes, login throttles, receipts and sessions.
      tables[table] =
        table === "users"
          ? await tx`SELECT id,login_id,display_name,role,active,session_version,last_login_at,password_changed_at,created_at,updated_at FROM users`
          : await tx.unsafe(`SELECT * FROM ${table}`);
    }
  });
  const snapshot: Snapshot = {
    schemaVersion: "skilled-history-v1",
    createdAt: new Date().toISOString(),
    tables,
    artifacts: [],
  };
  const bundle = new ArtifactStore(join(destination, "artifacts"));
  // This must be local even when exporting from the controller's remote storage client.
  for (const key of artifactKeys(tables)) {
    if (!safeKey(key)) {
      snapshot.artifacts.push({
        key,
        missing: "Prohibited credential-store reference; not exported",
      });
      continue;
    }
    try {
      const path = await store.materialize(key);
      if (/\.zip$/i.test(key))
        await inspectZip(path, { requireSkill: false, internalTransfer: true });
      const data = await bundle.putStream(
        key,
        (await import("node:fs")).createReadStream(path),
        250 * 1024 * 1024,
      );
      snapshot.artifacts.push(data);
    } catch (error) {
      snapshot.artifacts.push({
        key,
        missing: "Source artifact unavailable or outside export limits",
      });
    }
  }
  const bytes = JSON.stringify(snapshot, null, 2);
  await writeFile(join(destination, "history.json"), bytes, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(join(destination, "history.sha256"), sha256(bytes), {
    flag: "wx",
    mode: 0o600,
  });
  return {
    records: Object.fromEntries(
      TABLES.map((name) => [name, tables[name].length]),
    ),
    artifacts: snapshot.artifacts.length,
    missing: snapshot.artifacts.filter((a) => a.missing),
  };
}

export async function readSnapshot(source: string): Promise<Snapshot> {
  const bytes = await readFile(join(source, "history.json"), "utf8");
  if (
    sha256(bytes) !==
    (await readFile(join(source, "history.sha256"), "utf8")).trim()
  )
    throw new Error("History manifest checksum mismatch");
  const snapshot = JSON.parse(bytes) as Snapshot;
  if (
    snapshot.schemaVersion !== "skilled-history-v1" ||
    !snapshot.tables ||
    !Array.isArray(snapshot.artifacts)
  )
    throw new Error("Invalid history manifest");
  for (const table of TABLES)
    if (!Array.isArray(snapshot.tables[table]))
      throw new Error(`Missing table ${table}`);
  for (const row of snapshot.tables.users)
    if ("password_hash" in row)
      throw new Error("Credential-bearing user export is prohibited");
  const expected = artifactKeys(snapshot.tables);
  if (
    new Set(snapshot.artifacts.map((a) => a.key)).size !==
      snapshot.artifacts.length ||
    expected.length !== snapshot.artifacts.length ||
    expected.some((key) => !snapshot.artifacts.some((a) => a.key === key))
  )
    throw new Error("Artifact inventory does not match referenced objects");
  return snapshot;
}

export async function importHistory(
  sql: Db,
  store: ArtifactStore,
  source: string,
) {
  const snapshot = await readSnapshot(source);
  const importId = sha256(await readFile(join(source, "history.json")));
  const imported = new ArtifactStore(join(source, "artifacts"));
  for (const artifact of snapshot.artifacts) {
    if (artifact.missing) continue;
    if (!safeKey(artifact.key))
      throw new Error("Prohibited artifact reference");
    const path = imported.path(artifact.key);
    if ((await hashFile(path)) !== artifact.checksum)
      throw new Error(`Artifact checksum mismatch: ${artifact.key}`);
    await store.putFile(artifact.key, path); // Publish durable bytes before committing references.
  }
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(83746201)`;
    await tx`SELECT set_config('skilled.importing','true',true)`;
    await tx`CREATE TABLE IF NOT EXISTS history_imports (checksum text PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now(), counts jsonb NOT NULL)`;
    const [previous] =
      await tx`SELECT counts FROM history_imports WHERE checksum=${importId}`;
    if (previous) return { repeated: true, counts: previous.counts };
    const [count] =
      await tx`SELECT (SELECT count(*) FROM skills)+(SELECT count(*) FROM users) count`;
    if (Number(count!.count) !== 0)
      throw new Error(
        "Import requires an empty migrated destination; existing history is never overwritten",
      );
    const originals = new Map<string, string>();
    const pointers = new Map<string, string>();
    const allowedColumns = new Map<Table, Set<string>>();
    for (const table of TABLES) {
      const columns =
        await tx`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=${table}`;
      allowedColumns.set(
        table,
        new Set(columns.map((c) => String(c.column_name))),
      );
    }
    // References with cycles are restored only after all referenced rows exist.
    for (const table of TABLES) {
      const rows = [...snapshot.tables[table]];
      if (table === "skill_versions")
        rows.sort((a, b) => Number(a.version) - Number(b.version));
      for (const original of rows) {
        const row = structuredClone(original);
        if (
          Object.keys(row).some((key) => !allowedColumns.get(table)!.has(key))
        )
          throw new Error(`Unknown column in ${table}`);
        if (table === "users") {
          row.password_hash = "!reset-required";
          row.session_version = Number(row.session_version) + 1;
        }
        if (table === "skills") {
          if (row.active_version_id)
            pointers.set(row.id, row.active_version_id);
          row.active_version_id = null;
        }
        if (table === "eval_versions" || table === "runs") {
          originals.set(`${table}:${row.id}`, row.status);
          row.status = table === "runs" ? "queued" : "collecting";
        }
        if (table === "runs") row.provenance_status = "legacy_unverified";
        // A transport digest verifies preserved bytes, never historical test quality.
        if (
          table === "skill_versions" &&
          !row.installable_checksum &&
          row.installable_key
        ) {
          row.installable_checksum =
            snapshot.artifacts.find(
              (a) => a.key === row.installable_key && !a.missing,
            )?.checksum ?? null;
        }
        if (table === "conversations") row.codex_thread_id = null;
        if (table === "jobs" && ["running", "queued"].includes(row.status)) {
          row.status = "interrupted";
          row.completed_at = snapshot.createdAt;
          row.lease_owner = null;
          row.lease_expires_at = null;
          row.error = {
            code: "IMPORTED_INTERRUPTED",
            detail: "Imported active job; retry explicitly",
          };
        }
        // postgres.js serializes jsonb when it knows a target column only via explicit json().
        const jsonColumns = [
          "root_candidates",
          "manifest",
          "package_assessment",
          "readiness",
          "task_understanding",
          "coverage_plan",
          "answers",
          "questions",
          "generation_notes",
          "validation",
          "metadata",
          "evidence_provenance",
          "required_dimensions",
          "assertion_mapping",
          "source",
          "summary",
          "structured",
          "payload",
          "result",
          "error",
          "data",
          "settings",
          "engine_versions",
          "assertions",
          "dimensions",
          "artifacts",
          "tokens",
          "detail",
          "risks",
          "comparison",
          "skill_changes",
          "eval_changes",
          "input_hashes",
        ];
        for (const key of jsonColumns)
          if (row[key] !== null && typeof row[key] === "object")
            row[key] = tx.json(row[key]);
        await tx`INSERT INTO ${tx(table)} ${tx(row)}`;
      }
    }
    for (const table of TABLES) {
      const [count] = await tx`SELECT count(*) count FROM ${tx(table)}`;
      if (Number(count!.count) !== snapshot.tables[table].length)
        throw new Error(`Record reconciliation failed: ${table}`);
    }
    for (const [identity, status] of originals) {
      const [table, id] = identity.split(":");
      const restored =
        table === "runs" &&
        !["completed", "failed", "cancelled", "interrupted"].includes(status)
          ? "interrupted"
          : table === "eval_versions" &&
              ["understanding", "generating"].includes(status)
            ? "failed"
            : status;
      await tx`UPDATE ${tx(table!)} SET status=${restored} WHERE id=${id!}`;
    }
    for (const [id, active] of pointers)
      await tx`UPDATE skills SET active_version_id=${active} WHERE id=${id}`;
    for (const table of ["runs", "skill_versions", "update_proposals"] as const)
      for (const row of snapshot.tables[table])
        await tx`INSERT INTO history_assessments(resource_id,resource_type,assessment,detail) VALUES(${row.id},${table},'legacy_unverified',${tx.json({ importId, sourceStatus: row.status ?? "immutable_version" })}) ON CONFLICT(resource_id) DO UPDATE SET assessment='legacy_unverified',detail=excluded.detail`;
    await tx`SELECT setval(pg_get_serial_sequence('job_events','sequence'),COALESCE((SELECT max(sequence) FROM job_events),1),EXISTS(SELECT 1 FROM job_events))`;
    const counts = Object.fromEntries(
      TABLES.map((table) => [table, snapshot.tables[table].length]),
    );
    await tx`INSERT INTO history_imports(checksum,counts) VALUES(${importId},${tx.json(counts)})`;
    return {
      repeated: false,
      counts,
      missingArtifacts: snapshot.artifacts.filter((a) => a.missing),
    };
  });
}
