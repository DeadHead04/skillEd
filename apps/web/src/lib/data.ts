import {
  ArtifactStore,
  assessPackage,
  type PackageAssessment,
  PREVIEW_LIMIT,
  db,
  readZipEntry,
  type ZipEntryContent,
} from "@skilled/core";
import { readFile, stat } from "node:fs/promises";
import { executionAvailability } from "./execution-availability";
const sql = db();
const ready = Promise.resolve();
const severity: Record<string, number> = {
  PASS: 0,
  PARTIAL: 1,
  FAIL: 2,
  ERROR: 3,
};

function summarizeResults(results: any[]) {
  const worst = [...new Set(results.map((row) => row.case_id))].map(
    (caseId) =>
      results
        .filter((row) => row.case_id === caseId)
        .sort(
          (a, b) =>
            (severity[String(b.result)] ?? 3) -
            (severity[String(a.result)] ?? 3),
        )[0],
  );
  return {
    total: worst.length,
    pass: worst.filter((row) => row.result === "PASS").length,
    partial: worst.filter((row) => row.result === "PARTIAL").length,
    fail: worst.filter((row) => row.result === "FAIL").length,
    error: worst.filter((row) => row.result === "ERROR").length,
  };
}

export async function listSkills(): Promise<any[]> {
  await ready;
  const skills =
    await sql`SELECT s.*,v.id displayed_version_id,v.version active_version,v.description,v.manifest,v.status version_status,(SELECT latest.version FROM skill_versions latest WHERE latest.skill_id=s.id ORDER BY latest.version DESC LIMIT 1) latest_version,(SELECT latest.id FROM skill_versions latest WHERE latest.skill_id=s.id ORDER BY latest.version DESC LIMIT 1) latest_version_id FROM skills s LEFT JOIN skill_versions v ON v.id=COALESCE(s.active_version_id,(SELECT latest.id FROM skill_versions latest WHERE latest.skill_id=s.id ORDER BY latest.version DESC LIMIT 1)) ORDER BY s.updated_at DESC,s.name`;
  // Every lookup below is batched: the rail renders on every page, so a
  // per-skill query loop here would cost a round trip per package per render.
  const ids = skills.map((s) => s.displayed_version_id).filter(Boolean);
  const skillIds = skills.map((s) => s.id);
  const runs = ids.length
    ? await sql`SELECT DISTINCT ON (skill_version_id) id,status,created_at,skill_version_id FROM runs WHERE skill_version_id=ANY(${ids}::uuid[]) ORDER BY skill_version_id,created_at DESC`
    : [];
  const runIds = runs.map((r) => r.id);
  const results = runIds.length
    ? await sql`SELECT run_id,case_id,result FROM case_results WHERE run_id=ANY(${runIds}::uuid[]) AND configuration IN ('skill','with_skill')`
    : [];
  // The workflow rail shows where each package actually stands, so it needs
  // the latest eval and proposal alongside the latest run.
  const evals = skillIds.length
    ? await sql`SELECT DISTINCT ON (sv.skill_id) sv.skill_id,ev.id,ev.status,ev.version FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id WHERE sv.skill_id=ANY(${skillIds}::uuid[]) ORDER BY sv.skill_id,ev.created_at DESC`
    : [];
  const proposals = skillIds.length
    ? await sql`SELECT DISTINCT ON (sv.skill_id) sv.skill_id,p.id,p.status,p.activated_at FROM update_proposals p JOIN skill_versions sv ON sv.id=p.base_version_id WHERE sv.skill_id=ANY(${skillIds}::uuid[]) ORDER BY sv.skill_id,p.created_at DESC`
    : [];
  return skills.map((skill) => {
    const run = runs.find(
      (r) => r.skill_version_id === skill.displayed_version_id,
    );
    const evaluation = evals.find((e) => e.skill_id === skill.id);
    const proposal = proposals.find((p) => p.skill_id === skill.id);
    const summary = run
      ? summarizeResults(results.filter((row) => row.run_id === run.id))
      : null;
    return {
      ...skill,
      latestRun: run && summary ? { ...run, summary } : null,
      stages: {
        evals: {
          id: evaluation ? String(evaluation.id) : null,
          status: evaluation ? String(evaluation.status) : null,
          version: evaluation?.version ? Number(evaluation.version) : null,
        },
        runs: {
          id: run ? String(run.id) : null,
          status: run ? String(run.status) : null,
          summary,
        },
        improve: {
          id: proposal ? String(proposal.id) : null,
          status: proposal ? String(proposal.status) : null,
          activated: Boolean(proposal?.activated_at),
        },
      },
    };
  });
}

export async function currentSkill(
  skillId?: string,
  versionId?: string,
): Promise<any> {
  await ready;
  const [skill] = skillId
    ? await sql`SELECT s.*,row_to_json(v.*) version FROM skills s LEFT JOIN skill_versions v ON v.id=COALESCE(s.active_version_id,(SELECT latest.id FROM skill_versions latest WHERE latest.skill_id=s.id ORDER BY latest.version DESC LIMIT 1)) WHERE s.id=${skillId}`
    : await sql`SELECT s.*,row_to_json(v.*) version FROM skills s LEFT JOIN skill_versions v ON v.id=COALESCE(s.active_version_id,(SELECT latest.id FROM skill_versions latest WHERE latest.skill_id=s.id ORDER BY latest.version DESC LIMIT 1)) ORDER BY s.updated_at DESC LIMIT 1`;
  if (skill && versionId) {
    const [version] =
      await sql`SELECT * FROM skill_versions WHERE id=${versionId} AND skill_id=${skill.id}`;
    if (!version) return null;
    skill.version = version;
  }
  if (skill?.version)
    skill.version.importedHistory = Boolean(
      (
        await sql`SELECT 1 FROM history_assessments WHERE resource_id=${skill.version.id}`
      )[0],
    );
  return skill ?? null;
}
export async function currentEval(
  id?: string,
  skillId?: string,
  versionId?: string,
): Promise<any> {
  await ready;
  const [evaluation] =
    id && id !== "current"
      ? await sql`SELECT ev.*,sv.skill_id FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id WHERE ev.id=${id}`
      : versionId
        ? await sql`SELECT ev.*,sv.skill_id FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id WHERE ev.skill_version_id=${versionId} ORDER BY ev.created_at DESC LIMIT 1`
        : skillId
          ? await sql`SELECT ev.*,sv.skill_id FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id WHERE sv.skill_id=${skillId} ORDER BY ev.created_at DESC LIMIT 1`
          : await sql`SELECT ev.*,sv.skill_id FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id ORDER BY ev.created_at DESC LIMIT 1`;
  if (!evaluation) return null;
  const cases =
    await sql`SELECT * FROM eval_cases WHERE eval_version_id=${evaluation.id} ORDER BY case_id`;
  const files =
    await sql`SELECT * FROM eval_files WHERE eval_version_id=${evaluation.id} ORDER BY created_at`;
  const [activeJob] =
    await sql`SELECT id,status FROM jobs WHERE resource_id=${evaluation.id} AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`;
  const [failedJob] =
    await sql`SELECT id,type,status,error FROM jobs WHERE resource_id=${evaluation.id} AND type IN ('eval_author','eval_generate') AND status IN ('failed','interrupted') ORDER BY completed_at DESC NULLS LAST,created_at DESC LIMIT 1`;
  const messages =
    await sql`SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.resource_id=${evaluation.id} ORDER BY m.created_at`;
  const [conversation] =
    await sql`SELECT id,codex_thread_id FROM conversations WHERE resource_id=${evaluation.id} AND kind='eval_authoring' ORDER BY created_at DESC LIMIT 1`;
  return {
    ...evaluation,
    cases,
    files,
    activeJob,
    failedJob,
    messages,
    conversation,
    evidenceMode:
      evaluation.validation?.adapter === "codex"
        ? "real"
        : evaluation.validation?.adapter === "fake"
          ? "demo"
          : "unknown",
  };
}
export async function currentRun(id?: string, skillId?: string): Promise<any> {
  await ready;
  const [run] =
    id && id !== "current"
      ? await sql`SELECT r.*,sv.version skill_version,sv.skill_id,ev.version eval_version FROM runs r JOIN skill_versions sv ON sv.id=r.skill_version_id JOIN eval_versions ev ON ev.id=r.eval_version_id WHERE r.id=${id}`
      : skillId
        ? await sql`SELECT r.*,sv.version skill_version,sv.skill_id,ev.version eval_version FROM runs r JOIN skill_versions sv ON sv.id=r.skill_version_id JOIN eval_versions ev ON ev.id=r.eval_version_id WHERE sv.skill_id=${skillId} ORDER BY r.created_at DESC LIMIT 1`
        : await sql`SELECT r.*,sv.version skill_version,sv.skill_id,ev.version eval_version FROM runs r JOIN skill_versions sv ON sv.id=r.skill_version_id JOIN eval_versions ev ON ev.id=r.eval_version_id ORDER BY r.created_at DESC LIMIT 1`;
  if (!run) return null;
  const results =
    await sql`SELECT cr.*,ec.title,ec.coverage_group FROM case_results cr LEFT JOIN eval_cases ec ON ec.eval_version_id=${run.eval_version_id} AND ec.case_id=cr.case_id WHERE cr.run_id=${run.id} ORDER BY CASE cr.result WHEN 'ERROR' THEN 0 WHEN 'FAIL' THEN 1 WHEN 'PARTIAL' THEN 2 ELSE 3 END,cr.case_id,cr.iteration`;
  return {
    ...run,
    results,
    evidenceMode: run.engine_versions?.adapter ?? "unknown",
  };
}
export async function currentProposal(
  id?: string,
  skillId?: string,
): Promise<any> {
  await ready;
  const [p] =
    id && id !== "current"
      ? await sql`SELECT p.*,sv.version base_version,sv.skill_id FROM update_proposals p JOIN skill_versions sv ON sv.id=p.base_version_id WHERE p.id=${id}`
      : skillId
        ? await sql`SELECT p.*,sv.version base_version,sv.skill_id FROM update_proposals p JOIN skill_versions sv ON sv.id=p.base_version_id WHERE sv.skill_id=${skillId} ORDER BY p.created_at DESC LIMIT 1`
        : await sql`SELECT p.*,sv.version base_version,sv.skill_id FROM update_proposals p JOIN skill_versions sv ON sv.id=p.base_version_id ORDER BY p.created_at DESC LIMIT 1`;
  if (!p) return null;
  const sourceResults =
    await sql`SELECT cr.case_id,cr.assertions,ec.title FROM case_results cr JOIN runs r ON r.id=cr.run_id JOIN eval_cases ec ON ec.eval_version_id=r.eval_version_id AND ec.case_id=cr.case_id WHERE cr.run_id=${p.source_run_id} AND cr.configuration IN ('skill','with_skill')`;
  const targetedEvidence = Object.fromEntries(
    sourceResults.flatMap((r) =>
      (r.assertions ?? []).map((a: any) => [
        a.id,
        { caseId: r.case_id, title: r.title, text: a.text ?? a.id },
      ]),
    ),
  );
  let skillPatch = "Patch artifact is unavailable.";
  if (p.skill_patch_key) {
    try {
      skillPatch = await readFile(
        await new ArtifactStore().materialize(p.skill_patch_key),
        "utf8",
      );
    } catch {
      skillPatch = "Patch artifact could not be read.";
    }
  }
  let evalPatch = "";
  if (p.eval_patch_key) {
    try {
      evalPatch = await readFile(
        await new ArtifactStore().materialize(p.eval_patch_key),
        "utf8",
      );
    } catch {
      evalPatch = "Eval patch artifact could not be read.";
    }
  }
  const messages =
    await sql`SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.resource_id=${p.id} AND c.kind='skill_update' ORDER BY m.created_at`;
  const [conversation] =
    await sql`SELECT codex_thread_id FROM conversations WHERE resource_id=${p.id} AND kind='skill_update' ORDER BY created_at DESC LIMIT 1`;
  const [activeJob] =
    await sql`SELECT id,status FROM jobs WHERE (resource_id=${p.id} OR resource_id=${p.current_verification_run_id} OR resource_id=${p.candidate_verification_run_id}) AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`;
  return {
    ...p,
    activeVersionId:
      (
        await sql`SELECT active_version_id FROM skills WHERE id=${p.skill_id}`
      )[0]?.active_version_id ?? null,
    activeJob,
    targetedEvidence,
    skillPatch,
    evalPatch,
    messages,
    evidenceMode: (
      await sql`SELECT 1 FROM history_assessments WHERE resource_id=${p.id}`
    )[0]
      ? "legacy"
      : (
            await sql`SELECT adapter FROM jobs WHERE resource_id=${p.id} ORDER BY created_at LIMIT 1`
          )[0]?.adapter === "demo"
        ? "demo"
        : conversation?.codex_thread_id
          ? "real"
          : "unknown",
  };
}

/**
 * Deepest level of the drill-down: the actual bytes of a Skill file.
 *
 * Manifest paths are stored relative to the Skill root while the installable
 * archive keeps that root directory, so the root is rejoined here. Traversal
 * and size limits are enforced inside readZipEntry.
 */
export async function readSkillFile(
  versionId: string,
  path: string,
): Promise<ZipEntryContent | null> {
  await ready;
  const [version] =
    await sql`SELECT installable_key,original_key,selected_root FROM skill_versions WHERE id=${versionId}`;
  if (!version) return null;
  const key = version.installable_key ?? version.original_key;
  if (!key) return null;
  const inArchive = version.selected_root
    ? `${version.selected_root}/${path}`
    : path;
  try {
    const store = new ArtifactStore();
    return await readZipEntry(await store.materialize(key), inArchive);
  } catch {
    return null;
  }
}

/** The exact generated eval file — eval.yaml, a case YAML, or a judge script. */
export async function readEvalFile(
  evalId: string,
  path: string,
): Promise<ZipEntryContent | null> {
  await ready;
  const [evaluation] =
    await sql`SELECT bundle_key FROM eval_versions WHERE id=${evalId}`;
  if (!evaluation?.bundle_key) return null;
  try {
    const store = new ArtifactStore();
    return await readZipEntry(
      await store.materialize(evaluation.bundle_key),
      path,
    );
  } catch {
    return null;
  }
}

/** Uploaded task material is a plain artifact rather than an archive entry. */
export async function readTaskMaterial(
  fileId: string,
): Promise<(ZipEntryContent & { filename: string; kind: string }) | null> {
  await ready;
  const [file] =
    await sql`SELECT id,kind,filename,artifact_key,metadata FROM eval_files WHERE id=${fileId}`;
  if (!file) return null;
  // The typed task description is stored inline rather than as a file.
  if (!file.artifact_key)
    return {
      filename: String(file.filename),
      kind: String(file.kind),
      path: String(file.filename),
      size: String(file.metadata?.text ?? "").length,
      text: String(file.metadata?.text ?? ""),
      binary: false,
      truncated: false,
    };
  try {
    const target = await new ArtifactStore().materialize(file.artifact_key);
    const size = (await stat(target)).size;
    const bytes = await readFile(target);
    const body = bytes.subarray(0, PREVIEW_LIMIT);
    const binary = body.subarray(0, 8192).includes(0);
    return {
      filename: String(file.filename),
      kind: String(file.kind),
      path: String(file.filename),
      size,
      text: binary ? null : body.toString("utf8"),
      binary,
      truncated: size > PREVIEW_LIMIT,
    };
  } catch {
    return null;
  }
}

/** Task material rows for the package file browser. */
export async function taskMaterials(evalId: string): Promise<any[]> {
  await ready;
  return sql`SELECT id,kind,filename,artifact_key,metadata FROM eval_files WHERE eval_version_id=${evalId} ORDER BY kind,filename`;
}

export async function skillRuns(skillId: string): Promise<any[]> {
  await ready;
  const runs =
    await sql`SELECT r.*,sv.version skill_version,ev.version eval_version FROM runs r JOIN skill_versions sv ON sv.id=r.skill_version_id JOIN eval_versions ev ON ev.id=r.eval_version_id WHERE sv.skill_id=${skillId} ORDER BY r.created_at DESC LIMIT 8`;
  return Promise.all(
    runs.map(async (run) => {
      const results =
        await sql`SELECT case_id,result FROM case_results WHERE run_id=${run.id} AND configuration IN ('skill','with_skill')`;
      return { ...run, summary: summarizeResults(results) };
    }),
  );
}

export async function skillVersions(skillId: string): Promise<any[]> {
  return sql`SELECT sv.*,EXISTS(SELECT 1 FROM history_assessments h WHERE h.resource_id=sv.id) imported_history FROM skill_versions sv WHERE skill_id=${skillId} ORDER BY version DESC`;
}

export async function packageAssessment(
  version: any,
): Promise<PackageAssessment> {
  if (
    version.package_assessment?.schemaVersion ===
    "skilled-package-assessment-v1"
  )
    return version.package_assessment;
  const entries = version.manifest?.entries ?? [];
  const candidates = entries.filter((e: any) =>
    /\.md$|^agents\/openai\.yaml$/i.test(e.path),
  );
  const texts: Record<string, string> = {};
  const omitted: string[] = [];
  for (const entry of candidates.slice(0, 100)) {
    const file = await readSkillFile(version.id, entry.path);
    if (file?.text && !file.truncated) texts[entry.path] = file.text;
    else omitted.push(entry.path);
  }
  const result = assessPackage({
    name: version.name,
    selectedRoot: version.selected_root,
    packageHash: version.installable_checksum ?? version.checksum,
    entries,
    texts,
    excluded: version.manifest?.excluded ?? [],
  });
  if (candidates.length > 100 || omitted.length)
    result.findings.push({
      code: "INSPECTION_LIMIT",
      category: "advice",
      severity: "advisory",
      message: "Some files could not be inspected within preview limits.",
      action:
        "Download the package and inspect large or unavailable files before relying on this assessment.",
    });
  return result;
}
export async function currentExecutionAvailability() {
  const [worker] =
    await sql`SELECT last_seen_at,readiness FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1`;
  return executionAvailability(worker as any);
}
export async function studioHealth() {
  const [worker] =
    await sql`SELECT last_seen_at,readiness FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1`;
  const [queue] =
    await sql`SELECT count(*) FILTER(WHERE status='queued') queued,count(*) FILTER(WHERE status='running') running FROM jobs`;
  return {
    execution:
      worker && Date.now() - new Date(worker.last_seen_at).getTime() < 30000
        ? (worker.readiness?.execution ?? "blocked")
        : "blocked",
    queue,
  };
}

export async function latestRunForVersion(versionId: string) {
  const [run] =
    await sql`SELECT id,status,engine_versions FROM runs WHERE skill_version_id=${versionId} ORDER BY created_at DESC LIMIT 1`;
  return run ?? null;
}
