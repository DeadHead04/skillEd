import {
  definitionsFromMapping,
  requiredAssertionDimensions,
  type Db,
} from "@skilled/core";

type PendingCase = {
  definition: Record<string, any>;
  judge: string;
  assertions: Record<string, unknown>;
};

/** Returns the latest durable conversation for an eval resource and workflow kind. */
export async function findConversation(
  sql: Db,
  resourceId: string,
  kind: string,
) {
  const [conversation] =
    await sql`SELECT * FROM conversations WHERE resource_id=${resourceId} AND kind=${kind} ORDER BY created_at DESC LIMIT 1`;
  return conversation;
}

/** Persists a completed user or assistant message and its optional structured payload. */
export async function createConversationMessage(
  sql: Db,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  structured?: unknown,
) {
  await sql`INSERT INTO conversation_messages(conversation_id,role,content,structured,completed) VALUES(${conversationId},${role},${content},${structured === undefined ? null : sql.json(structured as never)},true)`;
}

/** Lists all eval materials needed to construct the isolated authoring workspace. */
export function findAuthorWorkspaceFiles(sql: Db, evalId: string) {
  return sql`SELECT id,kind,filename,artifact_key,metadata FROM eval_files WHERE eval_version_id=${evalId} ORDER BY created_at`;
}

/** Loads the eval, source Skill, and task metadata used during authoring. */
export async function findAuthoringContext(sql: Db, evalId: string) {
  const [context] =
    await sql`SELECT ev.*,sv.installable_key original_key,ef.metadata FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id LEFT JOIN eval_files ef ON ef.eval_version_id=ev.id AND ef.kind='task' WHERE ev.id=${evalId} LIMIT 1`;
  return context;
}

/** Moves an eval into the task-understanding phase. */
export async function markEvalUnderstanding(sql: Db, evalId: string) {
  await sql`UPDATE eval_versions SET status='understanding' WHERE id=${evalId}`;
}

/** Lists the lightweight material descriptors used by deterministic authoring. */
export function findMaterialSummaries(sql: Db, evalId: string) {
  return sql`SELECT kind,filename FROM eval_files WHERE eval_version_id=${evalId} ORDER BY created_at`;
}

/** Returns completed conversation history, including structured revision data. */
export function findStructuredConversationHistory(
  sql: Db,
  conversationId: string,
) {
  return sql`SELECT role,content,structured FROM conversation_messages WHERE conversation_id=${conversationId} AND completed=true ORDER BY created_at`;
}

/** Returns completed text history for generation recovery without revision payloads. */
export function findConversationHistory(sql: Db, conversationId: string) {
  return sql`SELECT role,content FROM conversation_messages WHERE conversation_id=${conversationId} AND completed=true ORDER BY created_at`;
}

/** Records the durable Codex thread associated with an authoring conversation. */
export async function saveConversationThread(
  sql: Db,
  conversationId: string,
  threadId: string,
) {
  await sql`UPDATE conversations SET codex_thread_id=${threadId},updated_at=now() WHERE id=${conversationId}`;
}

/** Saves the latest understanding and blocking questions for review. */
export async function saveUnderstanding(
  sql: Db,
  evalId: string,
  understanding: unknown,
  questions: unknown,
) {
  await sql`UPDATE eval_versions SET status='understanding',task_understanding=${sql.json(understanding as never)},questions=${sql.json(questions as never)} WHERE id=${evalId}`;
}

/** Saves demo understanding fields without changing the current workflow status. */
export async function saveDemoUnderstanding(
  sql: Db,
  evalId: string,
  understanding: unknown,
  questions: unknown,
) {
  await sql`UPDATE eval_versions SET task_understanding=${sql.json(understanding as never)},questions=${sql.json(questions as never)} WHERE id=${evalId}`;
}

/** Pauses authoring until required user answers are supplied. */
export async function markEvalAwaitingAnswers(sql: Db, evalId: string) {
  await sql`UPDATE eval_versions SET status='awaiting_answers' WHERE id=${evalId}`;
}

/** Stores a compact conversation summary after coverage planning completes. */
export async function saveConversationSummary(
  sql: Db,
  conversationId: string,
  summary: unknown,
) {
  await sql`UPDATE conversations SET summary=${sql.json(summary as never)},updated_at=now() WHERE id=${conversationId}`;
}

/** Saves the proposed plan and marks its validation as pending. */
export async function saveCoveragePlan(
  sql: Db,
  evalId: string,
  plan: unknown,
  adapter: string,
) {
  await sql`UPDATE eval_versions SET status='planning',coverage_plan=${sql.json(plan as never)},validation=${sql.json({ valid: false, adapter })} WHERE id=${evalId}`;
}

/** Makes the completed coverage plan available for explicit approval. */
export async function markEvalAwaitingPlanApproval(sql: Db, evalId: string) {
  await sql`UPDATE eval_versions SET status='awaiting_plan_approval' WHERE id=${evalId}`;
}

/** Loads the approved planning inputs and source Skill needed to generate a suite. */
export async function findGenerationContext(sql: Db, evalId: string) {
  const [context] =
    await sql`SELECT ev.coverage_plan,ev.task_understanding,ev.answers,sv.installable_key original_key,ef.metadata FROM eval_versions ev JOIN skill_versions sv ON sv.id=ev.skill_version_id LEFT JOIN eval_files ef ON ef.eval_version_id=ev.id AND ef.kind='task' WHERE ev.id=${evalId} LIMIT 1`;
  return context;
}

/** Lists stored case definitions so an approved suite can be rebuilt unchanged. */
export function findStoredCases(sql: Db, evalId: string) {
  return sql`SELECT source,enabled FROM eval_cases WHERE eval_version_id=${evalId} ORDER BY case_id`;
}

/** Lists material artifacts that can contribute fixtures or judge-only truth. */
export function findArtifactMaterials(sql: Db, evalId: string) {
  return sql`SELECT * FROM eval_files WHERE eval_version_id=${evalId} AND artifact_key IS NOT NULL ORDER BY id`;
}

/** Marks an eval as actively generating before bundle files are assembled. */
export async function markEvalGenerating(sql: Db, evalId: string) {
  await sql`UPDATE eval_versions SET status='generating' WHERE id=${evalId}`;
}

/** Lists every source so generated references and checksums can be verified. */
export function findSourceFiles(sql: Db, evalId: string) {
  return sql`SELECT id,kind,filename,artifact_key,metadata FROM eval_files WHERE eval_version_id=${evalId}`;
}

/** Atomically replaces generated cases and publishes the validated eval bundle. */
export async function completeEvalGeneration(
  sql: Db,
  input: {
    evalId: string;
    pendingCases: PendingCase[];
    bundleKey: string;
    checksum: string;
    generationNotes: string[];
    validationOutput: string;
    caseCount: number;
    adapter: string;
  },
) {
  await sql.begin(async (tx) => {
    const [draft] =
      await tx`SELECT status FROM eval_versions WHERE id=${input.evalId} FOR UPDATE`;
    if (!draft || draft.status !== "generating")
      throw new Error("Eval state changed during generation");
    await tx`DELETE FROM eval_cases WHERE eval_version_id=${input.evalId}`;
    for (const item of input.pendingCases) {
      const definition = item.definition;
      const requiredDimensions = requiredAssertionDimensions(
        definitionsFromMapping(item.assertions),
      );
      await tx`INSERT INTO eval_cases(eval_version_id,case_id,title,coverage_group,judge_type,evidence_provenance,required_dimensions,yaml_path,assertion_mapping,source) VALUES(${input.evalId},${definition.id},${definition.title},${definition.coverageGroup},${item.judge},${tx.json(definition.provenance)},${tx.json(requiredDimensions)},${`evals/cases/${definition.id.toLowerCase()}.yaml`},${tx.json(item.assertions as never)},${tx.json(definition)})`;
    }
    await tx`UPDATE eval_versions SET status='ready',bundle_key=${input.bundleKey},checksum=${input.checksum},generation_notes=${tx.json(input.generationNotes)},validation=${tx.json({ valid: true, validator: "skill-up validate", output: input.validationOutput, cases: input.caseCount, adapter: input.adapter })} WHERE id=${input.evalId}`;
  });
}
