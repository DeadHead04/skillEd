import { ArtifactStore, emit, type Db } from "@skilled/core";

export async function generateProposal(sql: Db, job: Record<string, any>) {
  const [proposal] =
    await sql`SELECT p.*,sv.name FROM update_proposals p JOIN skill_versions sv ON sv.id=p.base_version_id WHERE p.id=${job.resource_id}`;
  if (!proposal) throw new Error("Proposal not found");
  await emit(sql, job.id, "stage_changed", { stage: "analyzing_failures" });
  const patch = `--- a/SKILL.md\n+++ b/SKILL.md\n@@\n+## Grounding gate\n+Never return PASS unless every cited fact is present in an authoritative input. Treat omitted meaning, invented claims, and unrelated additions as failures.\n+Before finalizing, compare protected fields and report any unrelated drift.\n`;
  const key = `proposals/${proposal.id}/skill.patch`;
  await new ArtifactStore().put(key, Buffer.from(patch));
  const summary = {
    rootCause:
      "The Skill allows a fluent answer to substitute for grounded evidence.",
    intendedEffect:
      "Require evidence traceability and a protected-field drift check before PASS.",
    touchedFiles: ["SKILL.md"],
    verification:
      "Run current and candidate against the same approved eval version and settings.",
  };
  await sql`UPDATE update_proposals SET status='review',summary=${sql.json(summary)},risks=${sql.json(["May increase false negatives for underspecified inputs"])},skill_patch_key=${key},updated_at=now() WHERE id=${proposal.id}`;
  await emit(sql, job.id, "artifact_created", { kind: "skill_patch" });
  await emit(sql, job.id, "completed", { resourceId: proposal.id });
}
