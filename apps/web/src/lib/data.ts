import { ArtifactStore, db } from "@skilled/core";
import { readFile } from "node:fs/promises";
const sql = db();
const ready = Promise.resolve();
export async function currentSkill(): Promise<any> {
  await ready;
  const [skill] =
    await sql`SELECT s.*,row_to_json(v.*) version FROM skills s LEFT JOIN skill_versions v ON v.id=s.active_version_id LIMIT 1`;
  return skill ?? null;
}
export async function currentEval(id?: string): Promise<any> {
  await ready;
  const [evaluation] =
    id && id !== "current"
      ? await sql`SELECT * FROM eval_versions WHERE id=${id}`
      : await sql`SELECT * FROM eval_versions ORDER BY created_at DESC LIMIT 1`;
  if (!evaluation) return null;
  const cases =
    await sql`SELECT * FROM eval_cases WHERE eval_version_id=${evaluation.id} ORDER BY case_id`;
  const messages =
    await sql`SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.resource_id=${evaluation.id} ORDER BY m.created_at`;
  return { ...evaluation, cases, messages };
}
export async function currentRun(id?: string): Promise<any> {
  await ready;
  const [run] =
    id && id !== "current"
      ? await sql`SELECT r.*,sv.version skill_version,ev.version eval_version FROM runs r JOIN skill_versions sv ON sv.id=r.skill_version_id JOIN eval_versions ev ON ev.id=r.eval_version_id WHERE r.id=${id}`
      : await sql`SELECT r.*,sv.version skill_version,ev.version eval_version FROM runs r JOIN skill_versions sv ON sv.id=r.skill_version_id JOIN eval_versions ev ON ev.id=r.eval_version_id ORDER BY r.created_at DESC LIMIT 1`;
  if (!run) return null;
  const results =
    await sql`SELECT cr.*,ec.title,ec.coverage_group FROM case_results cr LEFT JOIN eval_cases ec ON ec.eval_version_id=${run.eval_version_id} AND ec.case_id=cr.case_id WHERE cr.run_id=${run.id} ORDER BY CASE cr.result WHEN 'ERROR' THEN 0 WHEN 'FAIL' THEN 1 WHEN 'PARTIAL' THEN 2 ELSE 3 END,cr.case_id,cr.iteration`;
  return { ...run, results };
}
export async function currentProposal(id?: string): Promise<any> {
  await ready;
  const [p] =
    id && id !== "current"
      ? await sql`SELECT p.*,sv.version base_version FROM update_proposals p JOIN skill_versions sv ON sv.id=p.base_version_id WHERE p.id=${id}`
      : await sql`SELECT p.*,sv.version base_version FROM update_proposals p JOIN skill_versions sv ON sv.id=p.base_version_id ORDER BY p.created_at DESC LIMIT 1`;
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
