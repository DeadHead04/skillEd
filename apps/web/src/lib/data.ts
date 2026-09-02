import { ArtifactStore, db } from "@skilled/core";
import { readFile } from "node:fs/promises";
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
        await sql`SELECT r.id,r.status,r.created_at FROM runs r JOIN skill_versions sv ON sv.id=r.skill_version_id WHERE sv.skill_id=${skill.id} ORDER BY r.created_at DESC LIMIT 1`;
      const results = run
        ? await sql`SELECT case_id,result FROM case_results WHERE run_id=${run.id}`
        : [];
      return {
        ...skill,
        latestRun: run ? { ...run, summary: summarizeResults(results) } : null,
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
  return { ...evaluation, cases, messages };
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
  return { ...run, results };
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
  return { ...p, skillPatch };
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
