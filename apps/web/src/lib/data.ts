import {
  ArtifactStore,
  PREVIEW_LIMIT,
  db,
  readZipEntry,
  type ZipEntryContent,
} from "@skilled/core";
import { readFile, stat } from "node:fs/promises";
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
    await sql`SELECT s.*,v.version active_version,v.description,v.status version_status FROM skills s LEFT JOIN skill_versions v ON v.id=s.active_version_id ORDER BY s.updated_at DESC,s.name`;
  return Promise.all(
    skills.map(async (skill) => {
      const [run] =
        await sql`SELECT r.id,r.status,r.created_at FROM runs r WHERE r.skill_version_id=${skill.active_version_id} ORDER BY r.created_at DESC LIMIT 1`;
      const results = run
        ? await sql`SELECT case_id,result FROM case_results WHERE run_id=${run.id}`
        : [];
      // The workflow rail shows where this package actually stands, so the
      // shell needs the latest eval and proposal alongside the latest run.
      const [evaluation] =
        await sql`SELECT ev.id,ev.status,ev.version FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id WHERE sv.skill_id=${skill.id} ORDER BY ev.created_at DESC LIMIT 1`;
      const [proposal] =
        await sql`SELECT p.id,p.status,p.activated_at FROM update_proposals p JOIN skill_versions sv ON sv.id=p.base_version_id WHERE sv.skill_id=${skill.id} ORDER BY p.created_at DESC LIMIT 1`;
      const summary = run ? summarizeResults(results) : null;
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
    }),
  );
}

export async function currentSkill(skillId?: string): Promise<any> {
  await ready;
  const [skill] = skillId
    ? await sql`SELECT s.*,row_to_json(v.*) version FROM skills s LEFT JOIN skill_versions v ON v.id=s.active_version_id WHERE s.id=${skillId}`
    : await sql`SELECT s.*,row_to_json(v.*) version FROM skills s LEFT JOIN skill_versions v ON v.id=s.active_version_id ORDER BY s.updated_at DESC LIMIT 1`;
  return skill ?? null;
}
export async function currentEval(id?: string, skillId?: string): Promise<any> {
  await ready;
  const [evaluation] =
    id && id !== "current"
      ? await sql`SELECT ev.*,sv.skill_id FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id WHERE ev.id=${id}`
      : skillId
        ? await sql`SELECT ev.*,sv.skill_id FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id WHERE sv.skill_id=${skillId} ORDER BY ev.created_at DESC LIMIT 1`
        : await sql`SELECT ev.*,sv.skill_id FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id ORDER BY ev.created_at DESC LIMIT 1`;
  if (!evaluation) return null;
  const cases =
    await sql`SELECT * FROM eval_cases WHERE eval_version_id=${evaluation.id} ORDER BY case_id`;
  const messages =
    await sql`SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.resource_id=${evaluation.id} ORDER BY m.created_at`;
  const [conversation] =
    await sql`SELECT id,codex_thread_id FROM conversations WHERE resource_id=${evaluation.id} AND kind='eval_authoring' ORDER BY created_at DESC LIMIT 1`;
  return {
    ...evaluation,
    cases,
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
  let skillPatch = "Patch artifact is unavailable.";
  if (p.skill_patch_key) {
    try {
      skillPatch = await readFile(
        new ArtifactStore().path(p.skill_patch_key),
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
        new ArtifactStore().path(p.eval_patch_key),
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
  return {
    ...p,
    skillPatch,
    evalPatch,
    messages,
    evidenceMode: conversation?.codex_thread_id
      ? "real"
      : p.skill_changes?.length
        ? "demo"
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
    return await readZipEntry(new ArtifactStore().path(key), inArchive);
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
    return await readZipEntry(
      new ArtifactStore().path(evaluation.bundle_key),
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
    const target = new ArtifactStore().path(file.artifact_key);
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
        await sql`SELECT case_id,result FROM case_results WHERE run_id=${run.id}`;
      return { ...run, summary: summarizeResults(results) };
    }),
  );
}
