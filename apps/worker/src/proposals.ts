import {
  ArtifactStore,
  UpdateProposalOutputSchema,
  emit,
  extractZip,
  type Db,
  unifiedFilePatch,
  sha256,
} from "@skilled/core";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { codexAppServer } from "./app-server.js";

export async function generateProposal(sql: Db, job: Record<string, any>) {
  const [proposal] =
    await sql`SELECT p.*,sv.name,sv.installable_key,sv.selected_root FROM update_proposals p JOIN skill_versions sv ON sv.id=p.base_version_id WHERE p.id=${job.resource_id}`;
  if (!proposal) throw new Error("Proposal not found");
  const [conversation] =
    await sql`SELECT * FROM conversations WHERE resource_id=${proposal.id} AND kind='skill_update' ORDER BY created_at DESC LIMIT 1`;
  if (!conversation) throw new Error("Skill update conversation not found");
  await emit(sql, job.id, "stage_changed", { stage: "analyzing_failures" });
  let output: z.infer<typeof UpdateProposalOutputSchema>;
  const store = new ArtifactStore();
  const cwd = join(
    process.env.WORK_ROOT ?? "/data/work",
    `proposal-${proposal.id}`,
  );
  await rm(cwd, { recursive: true, force: true });
  await mkdir(cwd, { recursive: true });
  if (process.env.SKILLED_ADAPTER_MODE === "fake") {
    await extractZip(await store.materialize(proposal.installable_key), cwd);
    const skillPath = join(cwd, proposal.selected_root, "SKILL.md");
    const current = await readFile(skillPath, "utf8");
    output = UpdateProposalOutputSchema.parse({
      rootCause:
        "The Skill allows a fluent answer to substitute for grounded evidence.",
      intendedEffect:
        "Require evidence traceability and a protected-field drift check before PASS.",
      verification:
        "Run current and candidate against the same approved eval version and settings.",
      risks: ["May increase false negatives for underspecified inputs"],
      skillChanges: [
        {
          path: "SKILL.md",
          action: "replace",
          reason: "Add an explicit evidence and scope gate.",
          content: `${current.trimEnd()}\n\n## Grounding gate\nNever return PASS unless every cited fact is present in an authoritative input. Treat omitted meaning, invented claims, and unrelated additions as failures.\nBefore finalizing, compare protected fields and report any unrelated drift.\n`,
        },
      ],
      evalChanges: [],
    });
  } else {
    await mkdir(join(cwd, "base-skill"), { recursive: true });
    await extractZip(
      await store.materialize(proposal.installable_key),
      join(cwd, "base-skill"),
    );
    await mkdir(join(cwd, ".agents/skills"), { recursive: true });
    await cp(
      "/opt/skilled/skill-upper",
      join(cwd, ".agents/skills/skill-upper"),
      { recursive: true },
    );
    const failures =
      await sql`SELECT cr.case_id,cr.result,cr.assertions,cr.dimensions,cr.error_class,cr.detail,ec.title,ec.source FROM case_results cr LEFT JOIN eval_cases ec ON ec.eval_version_id=${proposal.eval_version_id} AND ec.case_id=cr.case_id WHERE cr.run_id=${proposal.source_run_id} AND cr.result <> 'PASS' ORDER BY cr.case_id,cr.iteration`;
    await writeFile(
      join(cwd, "failure-evidence.json"),
      JSON.stringify(
        {
          sourceRunId: proposal.source_run_id,
          baseVersionId: proposal.base_version_id,
          evalVersionId: proposal.eval_version_id,
          failures,
        },
        null,
        2,
      ),
    );
    const revision = String(job.payload?.message ?? "").trim();
    const turn = await codexAppServer.structuredTurn(
      cwd,
      `Use $skill-upper. Inspect base-skill and failure-evidence.json. ${revision ? `The user requested this revision: ${revision}` : "Diagnose the failures and propose the smallest grounded correction."} Return complete replacement content for every Skill file you change. Eval changes must strengthen evidence or fix an invalid test; never weaken a criterion merely to obtain a pass. Do not edit files directly and do not include credentials or paths outside the Skill root.`,
      z.toJSONSchema(UpdateProposalOutputSchema),
      conversation.codex_thread_id,
      {
        recoveryContext: JSON.stringify(
          await sql`SELECT role,content FROM conversation_messages WHERE conversation_id=${conversation.id} AND completed=true ORDER BY created_at`,
        ),
        onThread: async (threadId) => {
          await sql`UPDATE conversations SET codex_thread_id=${threadId},updated_at=now() WHERE id=${conversation.id}`;
        },
        onDelta: async (delta) => {
          await emit(sql, job.id, "conversation_delta", { delta });
        },
        skill: {
          name: "skill-upper",
          path: join(cwd, ".agents/skills/skill-upper/SKILL.md"),
        },
      },
    );
    output = UpdateProposalOutputSchema.parse(turn.structured);
  }
  const baseRoot =
    process.env.SKILLED_ADAPTER_MODE === "fake"
      ? join(cwd, proposal.selected_root)
      : join(cwd, "base-skill", proposal.selected_root);
  const patch = await unifiedFilePatch(baseRoot, output.skillChanges);
  const skillKey = `proposals/${proposal.id}/${sha256(patch)}/skill.patch`;
  const evalKey = output.evalChanges.length
    ? `proposals/${proposal.id}/${sha256(JSON.stringify(output.evalChanges))}/eval.patch.json`
    : null;
  await store.put(skillKey, Buffer.from(patch));
  if (evalKey)
    await store.put(
      evalKey,
      Buffer.from(JSON.stringify(output.evalChanges, null, 2)),
    );
  await sql`INSERT INTO conversation_messages(conversation_id,role,content,structured) VALUES(${conversation.id},'assistant',${`Proposed ${output.skillChanges.length} Skill change${output.skillChanges.length === 1 ? "" : "s"} and ${output.evalChanges.length} eval change${output.evalChanges.length === 1 ? "" : "s"}.`},${sql.json(output)})`;
  await sql`UPDATE conversations SET summary=${sql.json(output)},updated_at=now() WHERE id=${conversation.id}`;
  await sql`UPDATE update_proposals SET status='review',summary=${sql.json({ rootCause: output.rootCause, intendedEffect: output.intendedEffect, touchedFiles: output.skillChanges.map((change) => change.path), verification: output.verification })},risks=${sql.json(output.risks)},skill_patch_key=${skillKey},eval_patch_key=${evalKey},skill_changes=${sql.json(output.skillChanges)},eval_changes=${sql.json(output.evalChanges)},skill_decision=null,eval_decision=null,updated_at=now() WHERE id=${proposal.id}`;
  await emit(sql, job.id, "artifact_created", { kind: "skill_patch" });
  if (evalKey)
    await emit(sql, job.id, "artifact_created", { kind: "eval_patch" });
  await emit(sql, job.id, "completed", { resourceId: proposal.id });
}
