import { chmod, cp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, join } from "node:path";
import {
  ArtifactStore,
  AuthoringRevisionSchema,
  AuthoringIntakeSchema,
  ConversationReplySchema,
  CoveragePlanSchema,
  TaskUnderstandingSchema,
  createZip,
  emit,
  extractZip,
  sha256,
  type Db,
  MaterialKindSchema,
  GeneratedEvalCaseSchema,
  validateCoverage,
  materialVisibility,
} from "@skilled/core";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { validatedGeneration } from "../validated-generation.js";
import {
  validateGeneratedSuite,
  generationSchemaForPlan,
} from "../eval-validation.js";
import { codexAppServer as appServer } from "../app-server.js";
import {
  AGENT_JUDGE_MODEL,
  AUTHORING_CONVERSATION_KIND,
  DEFAULT_EVAL_WORK_ROOT,
  DEFAULT_PLAN,
  DEFAULT_UNDERSTANDING,
  DEFAULT_WORK_ROOT,
  PRODUCT_UNDERSTANDING,
  cases,
  productCases,
} from "./constants.js";
import { MAX_NUM_TEST_CASES } from "../config.js";
import {
  buildCoveragePlanPrompt,
  buildEvalGenerationPrompt,
  buildIntakePrompt,
  buildRevisionPrompt,
} from "./prompts.js";
import {
  completeEvalGeneration,
  createConversationMessage,
  findArtifactMaterials,
  findAuthoringContext,
  findAuthorWorkspaceFiles,
  findConversation,
  findConversationHistory,
  findGenerationContext,
  findMaterialSummaries,
  findSourceFiles,
  findStoredCases,
  findStructuredConversationHistory,
  markEvalAwaitingAnswers,
  markEvalAwaitingPlanApproval,
  markEvalGenerating,
  markEvalUnderstanding,
  saveConversationSummary,
  saveConversationThread,
  saveCoveragePlan,
  saveDemoUnderstanding,
  saveUnderstanding,
} from "./queries.js";

export { DEFAULT_PLAN, DEFAULT_UNDERSTANDING } from "./constants.js";

const execute = promisify(execFile);

function safeName(value: string) {
  return basename(value)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);
}

async function conversationFor(sql: Db, resourceId: string, kind: string) {
  const conversation = await findConversation(sql, resourceId, kind);
  if (!conversation) throw new Error(`${kind} conversation not found`);
  return conversation;
}

async function stageAuthorWorkspace(
  sql: Db,
  evalId: string,
  originalKey: string,
) {
  const cwd = join(
    process.env.WORK_ROOT ?? DEFAULT_WORK_ROOT,
    `author-${evalId}`,
  );
  await mkdir(cwd, { recursive: true });
  await rm(join(cwd, "skill-package"), { recursive: true, force: true });
  await extractZip(
    await new ArtifactStore().materialize(originalKey),
    join(cwd, "skill-package"),
  );
  await mkdir(join(cwd, ".agents/skills"), { recursive: true });
  await cp(
    "/opt/skilled/skill-upper",
    join(cwd, ".agents/skills/skill-upper"),
    {
      recursive: true,
    },
  );
  const materialDir = join(cwd, "task-materials");
  await rm(materialDir, { recursive: true, force: true });
  await mkdir(materialDir, { recursive: true });
  const files = await findAuthorWorkspaceFiles(sql, evalId);
  const manifest = [];
  for (const file of files) {
    if (!file.artifact_key) {
      manifest.push({
        id: file.id,
        kind: file.kind,
        filename: file.filename,
        path: null,
        metadata: file.metadata,
        preview: String(file.metadata?.text ?? "").slice(0, 64000),
      });
      continue;
    }
    MaterialKindSchema.parse(file.kind);
    const relative = `${file.kind}/${file.id}-${safeName(file.filename)}`;
    const target = join(materialDir, relative);
    await mkdir(join(materialDir, file.kind), { recursive: true });
    await cp(await new ArtifactStore().materialize(file.artifact_key), target);
    const mime = String(file.metadata?.mime ?? "");
    const previewable =
      mime.startsWith("text/") ||
      /\.(md|txt|csv|json|ya?ml)$/i.test(String(file.filename));
    const preview = previewable
      ? (
          await import("node:fs/promises").then((fs) =>
            fs.readFile(target, "utf8"),
          )
        ).slice(0, 64_000)
      : undefined;
    manifest.push({
      id: file.id,
      kind: file.kind,
      filename: file.filename,
      path: `task-materials/${relative}`,
      metadata: file.metadata,
      ...(preview === undefined ? {} : { preview }),
    });
  }
  await writeFile(
    join(materialDir, "manifest.json"),
    JSON.stringify({ files: manifest }, null, 2),
  );
  return { cwd, files: manifest };
}

function isProductQcTask(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  return text.includes("product card") || text.includes("source fact");
}

function taskPlan(product: boolean) {
  const labels = product
    ? [
        ["decision-accuracy", "Decision accuracy"],
        ["warning-coverage", "Warning coverage"],
        ["citation-support", "Citation support"],
        ["protected-fields", "Protected fields"],
        ["output-structure", "Output structure"],
      ]
    : [
        ["task-outcome", "Task outcome"],
        ["instruction-coverage", "Instruction coverage"],
        ["source-grounding", "Source grounding"],
        ["change-boundaries", "Change boundaries"],
        ["output-contract", "Output contract"],
      ];
  const legacy = ["correctness", "semantic", "source", "scope", "artifact"];
  const ids = Object.fromEntries(
    legacy.map((name, i) => [name, labels[i]![0]!]),
  );
  return CoveragePlanSchema.parse({
    areas: labels.map(([id, label], i) => ({
      id,
      label,
      description: `${label}: check the requested task against its supplied evidence.`,
      role: i === 0 ? "task_success" : "constraint",
      required: true,
      sourceReferences: [],
    })),
    groups: DEFAULT_PLAN.groups.map((g) => ({
      ...g,
      dimensions: g.dimensions.map((d) => ids[d]),
    })),
  });
}

export async function authorEval(sql: Db, job: Record<string, any>) {
  const phase = String(job.payload?.phase ?? "initial");
  await emit(sql, job.id, "stage_changed", { stage: phase });
  const context = await findAuthoringContext(sql, String(job.resource_id));
  if (!context) throw new Error("Eval context not found");
  if (phase === "initial")
    await markEvalUnderstanding(sql, String(job.resource_id));
  const conversation = await conversationFor(
    sql,
    String(job.resource_id),
    AUTHORING_CONVERSATION_KIND,
  );
  let understanding = isProductQcTask(context.metadata?.text)
      ? PRODUCT_UNDERSTANDING
      : DEFAULT_UNDERSTANDING,
    plan = taskPlan(isProductQcTask(context.metadata?.text)),
    questions: Array<Record<string, any>> = [],
    codexThreadId: string | undefined = conversation.codex_thread_id;
  const materials = await findMaterialSummaries(sql, String(job.resource_id));

  if (phase === "message") {
    const message = String(job.payload?.message ?? "").trim();
    if (!message) throw new Error("Conversation message is empty");
    if (process.env.SKILLED_ADAPTER_MODE === "fake") {
      await createConversationMessage(
        sql,
        conversation.id,
        "assistant",
        "Demo revision prepared. Review the proposed task understanding and coverage before applying it.",
        {
          reply: "Demo revision",
          baseRevision: context.revision,
          revision: {
            understanding: {
              ...context.task_understanding,
              ambiguity: [
                ...(context.task_understanding?.ambiguity ?? []),
                message,
              ],
            },
            plan: context.coverage_plan,
          },
        },
      );
    } else {
      const { cwd } = await stageAuthorWorkspace(
        sql,
        String(job.resource_id),
        context.original_key,
      );
      const turn = await appServer.structuredTurn(
        cwd,
        buildRevisionPrompt(
          message,
          context.task_understanding,
          context.coverage_plan,
        ),
        z.toJSONSchema(AuthoringRevisionSchema),
        codexThreadId,
        {
          recoveryContext: JSON.stringify(
            await findStructuredConversationHistory(sql, conversation.id),
          ),
          onThread: async (id) => {
            codexThreadId = id;
            await saveConversationThread(sql, conversation.id, id);
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
      const reply = AuthoringRevisionSchema.parse(turn.structured);
      await createConversationMessage(
        sql,
        conversation.id,
        "assistant",
        reply.reply,
        {
          ...reply,
          baseRevision: context.revision,
        },
      );
    }
    await emit(sql, job.id, "completed", {
      resourceId: job.resource_id,
      stage: context.status,
    });
    return;
  }

  if (process.env.SKILLED_ADAPTER_MODE !== "fake") {
    const { cwd, files } = await stageAuthorWorkspace(
      sql,
      String(job.resource_id),
      context.original_key,
    );
    const hooks = {
      recoveryContext: JSON.stringify(
        await findStructuredConversationHistory(sql, conversation.id),
      ),
      onThread: async (id: string) => {
        codexThreadId = id;
        await saveConversationThread(sql, conversation.id, id);
      },
      onDelta: async (delta: string) => {
        await emit(sql, job.id, "conversation_delta", { delta });
      },
      skill: {
        name: "skill-upper",
        path: join(cwd, ".agents/skills/skill-upper/SKILL.md"),
      },
    };
    if (phase === "initial") {
      const first = await appServer.structuredTurn(
        cwd,
        buildIntakePrompt(context.metadata?.text, files),
        z.toJSONSchema(AuthoringIntakeSchema),
        codexThreadId,
        hooks,
      );
      const intake = AuthoringIntakeSchema.parse(first.structured);
      understanding = intake.understanding;
      questions = intake.questions;
      await createConversationMessage(
        sql,
        conversation.id,
        "assistant",
        questions.length
          ? `I mapped the task and need ${questions.length} material answer${questions.length === 1 ? "" : "s"} before planning.`
          : "I mapped the task and found no blocking ambiguity.",
        intake,
      );
      await saveUnderstanding(
        sql,
        String(job.resource_id),
        understanding,
        questions,
      );
      if (questions.some((item) => item.required)) {
        await markEvalAwaitingAnswers(sql, String(job.resource_id));
        await emit(sql, job.id, "completed", {
          resourceId: job.resource_id,
          stage: "awaiting_answers",
        });
        return;
      }
    } else {
      understanding = TaskUnderstandingSchema.parse(context.task_understanding);
    }
    const second = await appServer.structuredTurn(
      cwd,
      buildCoveragePlanPrompt(context.answers, MAX_NUM_TEST_CASES),
      z.toJSONSchema(CoveragePlanSchema),
      codexThreadId,
      hooks,
    );
    plan = CoveragePlanSchema.parse(second.structured);
    if (!plan.areas.length)
      throw new Error("Codex must propose task-specific judging areas");
    validateCoverage(plan);
    await createConversationMessage(
      sql,
      conversation.id,
      "assistant",
      "The evidence coverage plan is ready for review.",
      plan,
    );
    await saveConversationSummary(sql, conversation.id, {
      understanding,
      questions: context.questions ?? questions,
      answers: context.answers,
      plan,
    });
  } else if (phase === "initial") {
    const kinds = new Set(materials.map((item) => item.kind));
    if (!kinds.has("authority") && !kinds.has("expected"))
      questions = [
        {
          id: "source_of_truth",
          prompt:
            "Which supplied source should decide whether an answer is correct?",
          whyItMatters:
            "Without an authority or expected output, false-PASS checks can only be provisional.",
          required: true,
          answerType: "text",
          choices: [],
        },
      ];
    await createConversationMessage(
      sql,
      conversation.id,
      "assistant",
      questions.length
        ? "I mapped the task, but one source-of-truth answer is required."
        : "I mapped the task and prepared an evidence coverage plan.",
      { understanding, questions },
    );
    await saveDemoUnderstanding(
      sql,
      String(job.resource_id),
      understanding,
      questions,
    );
    if (questions.length) {
      await markEvalAwaitingAnswers(sql, String(job.resource_id));
      await emit(sql, job.id, "completed", {
        resourceId: job.resource_id,
        stage: "awaiting_answers",
      });
      return;
    }
  } else if (phase === "answers") {
    await createConversationMessage(
      sql,
      conversation.id,
      "assistant",
      "The answers are saved and the evidence coverage plan is ready for review.",
      plan,
    );
  }
  await saveCoveragePlan(
    sql,
    String(job.resource_id),
    plan,
    process.env.SKILLED_ADAPTER_MODE === "fake" ? "fake" : "codex",
  );
  await markEvalAwaitingPlanApproval(sql, String(job.resource_id));
  await emit(sql, job.id, "completed", {
    resourceId: job.resource_id,
    stage: "awaiting_plan_approval",
  });
}

export async function generateEval(sql: Db, job: Record<string, any>) {
  const id = String(job.resource_id);
  const context = await findGenerationContext(sql, id);
  if (!context) throw new Error("Eval context not found");
  const fallback = isProductQcTask(context?.metadata?.text)
    ? productCases
    : cases;
  let generationNotes: string[] = [];
  let caseSet: Array<z.infer<typeof GeneratedEvalCaseSchema>> = fallback.map(
    ([caseId, title, group, judge, dimensions]) => ({
      assertions: [],
      id: caseId,
      title,
      coverageGroup: group,
      purpose: `Regression coverage for ${group}`,
      prompt: `Perform the uploaded task for adversarial case ${caseId}. Return grounded evidence and do not change unrelated content.`,
      judgeType: judge,
      dimensions: [...dimensions],
      provenance: group.startsWith("False")
        ? ["recorded failure patterns"]
        : ["task invariants"],
      criteria: dimensions.map(
        (dimension) =>
          `[${caseId}-${dimension}] Satisfy the required ${dimension} dimension with grounded evidence.`,
      ),
      sourceReferences: [],
      deterministicChecks:
        judge === "script"
          ? dimensions.map((dimension) => ({
              kind: "contains" as const,
              value: caseId,
              dimension,
              file: dimension === "artifact" ? "output.txt" : undefined,
              format: "text" as const,
              selector: "",
              allowedPaths: [],
            }))
          : [],
    }),
  );
  if (job.payload?.rebuild) {
    const stored = await findStoredCases(sql, id);
    caseSet = stored
      .filter((c) => c.enabled)
      .map((c) => GeneratedEvalCaseSchema.parse(c.source));
    if (!caseSet.length)
      throw new Error("At least one enabled case is required");
  } else if (process.env.SKILLED_ADAPTER_MODE !== "fake") {
    const conversation = await conversationFor(
      sql,
      id,
      AUTHORING_CONVERSATION_KIND,
    );
    const { cwd, files } = await stageAuthorWorkspace(
      sql,
      id,
      context.original_key,
    );
    let threadId = conversation.codex_thread_id;
    const responseSchema = generationSchemaForPlan(
      CoveragePlanSchema.parse(context.coverage_plan),
    );
    const suite = await validatedGeneration({
      generate: async (feedback) => {
        const turn = await appServer.structuredTurn(
          cwd,
          buildEvalGenerationPrompt({
            coveragePlan: context.coverage_plan,
            taskUnderstanding: context.task_understanding,
            answers: context.answers,
            maxCases: MAX_NUM_TEST_CASES,
            feedback,
          }),
          z.toJSONSchema(responseSchema),
          threadId,
          {
            recoveryContext: JSON.stringify(
              await findConversationHistory(sql, conversation.id),
            ),
            onThread: async (threadId) => {
              await saveConversationThread(sql, conversation.id, threadId);
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
        threadId = turn.threadId;
        return turn.structured;
      },
      validate: async (value) => {
        const grouped = responseSchema.parse(value);
        const suite = validateGeneratedSuite(
          {
            cases: Object.values(grouped.casesByGroup).flat(),
            generationNotes: grouped.generationNotes,
          },
          CoveragePlanSchema.parse(context.coverage_plan),
          files,
        );
        for (const item of suite.cases)
          for (const check of item.deterministicChecks.filter(
            (c) => c.kind === "json_schema",
          ))
            await execute(
              "python3",
              [
                "-c",
                "import runpy,sys; runpy.run_path(sys.argv[1])['artifact_schema'](sys.argv[2])",
                fileURLToPath(
                  new URL(
                    "../../../packages/core/src/judge-harness.py",
                    import.meta.url,
                  ),
                ),
                String(check.value),
              ],
              { timeout: 5000, maxBuffer: 8000 },
            );
        return suite;
      },
      rejected: async (value, error, attempt) => {
        await createConversationMessage(
          sql,
          conversation.id,
          "assistant",
          `Generated suite rejected (attempt ${attempt}/3): ${error}`,
          { rejected: true, validationError: error, proposal: value },
        );
        await emit(sql, job.id, "warning", {
          detail: error,
          attempt,
          stage: "correcting_generated_suite",
        });
      },
    });
    caseSet = suite.cases;
    generationNotes = suite.generationNotes;
    await createConversationMessage(
      sql,
      conversation.id,
      "assistant",
      `Generated ${caseSet.length} concrete eval cases for validation.`,
      suite,
    );
  }
  const approvedPlan = CoveragePlanSchema.parse(context.coverage_plan);
  if (
    process.env.SKILLED_ADAPTER_MODE === "fake" &&
    !job.payload?.rebuild &&
    approvedPlan.areas.length
  ) {
    const oldIds = ["correctness", "semantic", "source", "scope", "artifact"];
    const map = Object.fromEntries(
      oldIds.map((id, i) => [id, approvedPlan.areas[i]!.id]),
    );
    caseSet = caseSet.map((item) => ({
      ...item,
      dimensions: item.dimensions.map((d) => map[d]!),
      assertions: item.dimensions.map((d, i) => ({
        id: `${item.id}-${map[d]}`,
        areaId: map[d]!,
        text: item.criteria[i]!,
        required: true,
        role:
          d === "correctness"
            ? ("task_success" as const)
            : ("constraint" as const),
      })),
      deterministicChecks: item.deterministicChecks.map((c) => ({
        ...c,
        dimension: map[c.dimension]!,
        assertionId: `${item.id}-${map[c.dimension]}`,
      })),
    }));
  }
  validateCoverage(approvedPlan, caseSet);
  if (
    caseSet.length > MAX_NUM_TEST_CASES ||
    new Set(caseSet.map((c) => c.id)).size !== caseSet.length
  )
    throw new Error("Invalid case count or duplicate case IDs");
  if (process.env.SKILLED_ADAPTER_MODE !== "fake" && !job.payload?.rebuild) {
    const planned = (context.coverage_plan.groups ?? []).reduce(
      (n: number, group: any) => n + Number(group.caseCount),
      0,
    );
    if (planned !== caseSet.length)
      throw new Error("Generated cases do not match approved coverage count");
  }
  const materials = await findArtifactMaterials(sql, id);
  const fixtureEntries: string[] = [];
  const truth: Record<string, string> = {};
  const pendingCases: Array<{
    definition: Record<string, any>;
    judge: string;
    assertions: Record<string, unknown>;
  }> = [];
  const root = join(
    process.env.WORK_ROOT ?? DEFAULT_EVAL_WORK_ROOT,
    `eval-${id}`,
  );
  try {
    const evalDir = join(root, "evals/cases");
    await mkdir(evalDir, { recursive: true });
    await markEvalGenerating(sql, id);
    await emit(sql, job.id, "stage_changed", { stage: "generating" });
    const manifest: any = {
      schemaVersion: 3,
      profile: approvedPlan,
      cases: {},
      fixtures: [],
    };
    for (const file of materials) {
      MaterialKindSchema.parse(file.kind);
      const bytes = await readFile(
        await new ArtifactStore().materialize(file.artifact_key),
      );
      truth[file.id] = bytes.toString("base64");
      if (
        materialVisibility(file.kind, file.metadata?.visibility) !==
        "agent_input"
      )
        continue;
      const relativePath = `evals/fixtures/inputs/${file.id}-${safeName(file.filename)}`;
      await mkdir(join(root, "evals/fixtures/inputs"), { recursive: true });
      await writeFile(join(root, relativePath), bytes);
      fixtureEntries.push(relativePath);
      manifest.fixtures.push({
        id: file.id,
        path: `inputs/${file.id}-${safeName(file.filename)}`,
        checksum: sha256(bytes),
      });
    }
    const sourceFiles = await findSourceFiles(sql, id);
    manifest.sources = await Promise.all(
      sourceFiles.map(async (file) => ({
        id: file.id,
        kind: file.kind,
        filename: file.filename,
        checksum: file.artifact_key
          ? sha256(
              await readFile(
                await new ArtifactStore().materialize(file.artifact_key),
              ),
            )
          : sha256(JSON.stringify(file.metadata)),
      })),
    );
    for (const definition of caseSet) {
      if (
        process.env.SKILLED_ADAPTER_MODE !== "fake" &&
        (!definition.sourceReferences.length ||
          definition.sourceReferences.some(
            (reference) =>
              !sourceFiles.some((file) => file.id === reference.materialId),
          ))
      )
        throw new Error("Every real case requires valid material references");
      if (
        definition.judgeType === "script" &&
        definition.dimensions.includes("artifact") &&
        !definition.deterministicChecks.some(
          (check) => check.dimension === "artifact" && check.file,
        )
      )
        throw new Error("Artifact assertions must inspect an output file");
      const {
        id: caseId,
        title,
        coverageGroup: group,
        judgeType: requestedJudge,
        dimensions,
      } = definition;
      if (
        requestedJudge === "script" &&
        !dimensions.every((dimension) =>
          definition.deterministicChecks.some(
            (check) => check.dimension === dimension,
          ),
        )
      )
        throw new Error(
          `Script validators must cover every required dimension: ${caseId}`,
        );
      const judge = requestedJudge;
      if (
        !definition.assertions.length &&
        (definition.criteria.length !== dimensions.length ||
          new Set(dimensions).size !== dimensions.length ||
          new Set(definition.criteria).size !== definition.criteria.length)
      )
        throw new Error(`Invalid dimension/criteria mapping: ${caseId}`);
      const assertions = definition.assertions.length
        ? definition.assertions.map((a) => ({
            ...a,
            text: `[${a.id}] ${a.text}`,
            dimension: a.areaId,
          }))
        : dimensions.map((dimension, index) => ({
            id: `${caseId}-${dimension}`,
            text: `[${caseId}-${dimension}] ${definition.criteria[index]!}`,
            dimension,
            required: true,
            areaId: dimension,
            role:
              dimension === "correctness"
                ? ("task_success" as const)
                : ("constraint" as const),
          }));
      const prompt = definition.prompt;
      const judgeConfig =
        judge === "agent"
          ? {
              type: "agent_judge",
              model: AGENT_JUDGE_MODEL,
              criteria: assertions.map((item) => item.text),
              pass_threshold: 1,
              timeout_seconds: 180,
            }
          : {
              type: "script",
              script_path: `evals/scripts/${caseId.toLowerCase()}.py`,
              timeout_seconds: 30,
            };
      const spec = {
        id: caseId,
        title,
        description: definition.purpose,
        input: { prompt },
        // The pinned CLI resolves fixtures from the Skill root, not evals/.
        context: fixtureEntries.length
          ? { repo_fixture: "evals/fixtures" }
          : {},
        collect_artifacts: [
          "outputs/**",
          "*.xlsx",
          "*.csv",
          "*.json",
          "*.txt",
          "*.md",
        ],
        constraints: { timeout_seconds: 900, max_turns: 8 },
        judge: judgeConfig,
      };
      await writeFile(
        join(evalDir, `${caseId.toLowerCase()}.yaml`),
        JSON.stringify(spec, null, 2),
      );
      manifest.cases[caseId] = {
        title,
        coverageGroup: group,
        judge,
        evidenceProvenance: definition.provenance,
        sourceReferences: definition.sourceReferences,
        assertions: Object.fromEntries(
          assertions.map((a) => [
            a.text,
            {
              id: a.id,
              dimension: a.dimension,
              areaId: a.areaId,
              role: a.role,
              required: a.required,
            },
          ]),
        ),
      };
      pendingCases.push({
        definition,
        judge,
        assertions: manifest.cases[caseId].assertions,
      });
      if (judge === "script") {
        const scriptDir = join(root, "evals/scripts");
        await mkdir(scriptDir, { recursive: true });
        const script = join(scriptDir, `${caseId.toLowerCase()}.py`);
        const selectedTruth = Object.fromEntries(
          definition.deterministicChecks
            .filter((c) => c.expectedMaterialId)
            .map((c) => {
              if (!truth[c.expectedMaterialId!])
                throw new Error("Unknown expected material");
              return [c.expectedMaterialId!, truth[c.expectedMaterialId!]];
            }),
        );
        const harness = await readFile(
          new URL(
            "../../../packages/core/src/judge-harness.py",
            import.meta.url,
          ),
          "utf8",
        );
        const specification = JSON.stringify({
          assertions,
          checks: definition.deterministicChecks,
          truth: selectedTruth,
        });
        await writeFile(
          script,
          `#!/usr/bin/env python3\n${harness}\nsys.exit(run_checks(json.loads(${JSON.stringify(specification)})))\n`,
        );
        await chmod(script, 0o755);
      }
    }
    await writeFile(
      join(root, "evals/skilled.manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    const evaluation = {
      schema_version: "v1alpha1",
      environment: {
        type: "none",
        workspace_mount: "/workspace",
        env: { TZ: "UTC" },
      },
      mcp: { servers: [] },
      skills: [{ source: "local_path", path: "." }],
      engine: { name: "codex", model: { name: AGENT_JUDGE_MODEL } },
      cases: {
        files: caseSet.map(
          ({ id: caseId }) => `evals/cases/${caseId.toLowerCase()}.yaml`,
        ),
        defaults: { timeout_seconds: 900, max_turns: 8 },
        parallelism: 1,
        retry_policy: { max_retries: 1, retry_on: ["error"] },
      },
      benchmark: { enabled: false },
      report: { formats: ["json", "html"], artifacts: ["transcript"] },
    };
    await writeFile(
      join(root, "evals/eval.yaml"),
      JSON.stringify(evaluation, null, 2),
    );
    const validation = await execute(
      process.env.SKILL_UP_BIN ?? "skill-up",
      ["validate", join(root, "evals/eval.yaml")],
      { cwd: root, timeout: 60_000 },
    ).catch((error) => {
      throw new Error(
        `Skill-Up validation failed: ${error.stderr ?? error.message}`,
      );
    });
    const bundleEntries = [
      "evals/eval.yaml",
      "evals/skilled.manifest.json",
      ...fixtureEntries,
      ...caseSet.map(
        ({ id: caseId }) => `evals/cases/${caseId.toLowerCase()}.yaml`,
      ),
      ...caseSet
        .filter(({ id: caseId }) => manifest.cases[caseId].judge === "script")
        .map(({ id: caseId }) => `evals/scripts/${caseId.toLowerCase()}.py`),
    ];
    const bundle = join(root, "bundle.zip");
    await createZip(root, bundleEntries, bundle);
    const store = new ArtifactStore();
    const bytes = await import("node:fs/promises").then((fs) =>
      fs.readFile(bundle),
    );
    const key = `eval-versions/${id}/bundles/${sha256(bytes)}.zip`;
    await store.put(key, bytes);
    const checksum = sha256(bytes);
    await completeEvalGeneration(sql, {
      evalId: id,
      pendingCases,
      bundleKey: key,
      checksum,
      generationNotes,
      validationOutput: validation.stdout.trim(),
      caseCount: caseSet.length,
      adapter: process.env.SKILLED_ADAPTER_MODE === "fake" ? "fake" : "codex",
    });
    await emit(sql, job.id, "artifact_created", { kind: "eval_bundle" });
    await emit(sql, job.id, "completed", {
      resourceId: id,
      cases: caseSet.length,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
