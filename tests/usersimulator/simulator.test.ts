import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseDecision,
  createSimulator,
  simulatorPrompt,
  anthropicResponseText,
  openAIResponseText,
  MustReply,
  MayStop,
  type Decision,
  type ResponsePolicy,
} from "../../src/usersimulator/index.js";
import { Resolver } from "../../src/credentials/index.js";
const vectors = JSON.parse(
  await readFile(
    new URL(
      "../../../tests/usersimulator/reference-decisions.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Array<{
  raw: string;
  policy: ResponsePolicy;
  decision?: Decision;
  error?: string;
}>;
for (const [i, v] of vectors.entries())
  test(`original Go simulator decision ${i + 1}: ${v.policy}`, () => {
    if (v.error) {
      assert.throws(
        () => parseDecision(v.raw, v.policy),
        v.error.startsWith("invalid user simulator decision:")
          ? /^Error: invalid user simulator decision:/
          : { message: v.error },
      );
    } else assert.deepEqual(parseDecision(v.raw, v.policy), v.decision);
  });
test("simulator request retains exact scenario/history escaping and stopping policy", () => {
  const must = simulatorPrompt(
    "deploy <none>",
    "Which env?",
    [{ user: "staging", agent: "<script> & \u2028" }],
    MustReply,
  );
  assert.equal(
    must.request,
    'Scenario:\ndeploy <none>\n\nCurrent instruction:\nWhich env?\n\nConversation (JSON):\n[{"user":"staging","agent":"\\u003cscript\\u003e \\u0026 \\u2028"}]',
  );
  assert.ok(
    must.prompt.endsWith("Return action=reply with one non-empty message."),
  );
  const may = simulatorPrompt("", "", null, MayStop);
  assert.ok(may.request.endsWith("null"));
  assert.match(may.prompt, /Return action=stop when/);
});
test("actual SDK simulator construction rejects missing resolver/provider/protocol/key/base URL", () => {
  const cfg = {
    provider: "isolated",
    protocol: "openai",
    model: "configured",
    timeout_seconds: 1,
  };
  assert.throws(() => createSimulator(cfg, null), /resolver is unavailable/);
  const empty = new Resolver("", { env: {} });
  assert.throws(
    () => createSimulator({ ...cfg, protocol: "invalid" }, empty),
    /requires provider/,
  );
  assert.throws(() => createSimulator(cfg, empty), /API key is missing/);
  const withKey = new Resolver("", {
    env: { ISOLATED_API_KEY: "construction-only" },
  });
  assert.throws(() => createSimulator(cfg, withKey), /base URL is missing/);
});
for (const protocol of ["openai", "anthropic"])
  test(`actual ${protocol} SDK respects pre-cancelled caller before any request`, async () => {
    const resolver = new Resolver("", {
      env: {
        ISOLATED_API_KEY: "construction-only",
        ISOLATED_BASE_URL: "https://example.invalid",
      },
    });
    const simulator = createSimulator(
      {
        provider: "isolated",
        protocol,
        model: "configured",
        timeout_seconds: 1,
      },
      resolver,
    );
    await assert.rejects(
      simulator.next(
        "",
        "",
        [],
        MustReply,
        AbortSignal.abort(new Error("cancelled by caller")),
      ),
      /user simulator model call: cancelled by caller/,
    );
  });
test("provider response extraction preserves source stop/content rules", () => {
  assert.equal(
    anthropicResponseText({
      stop_reason: "end_turn",
      content: [
        { type: "thinking" },
        { type: "text", text: "one" },
        { type: "redacted_thinking" },
        { type: "text", text: "two" },
      ],
    }),
    "onetwo",
  );
  assert.throws(
    () => anthropicResponseText({ stop_reason: "max_tokens", content: [] }),
    /incomplete response: max_tokens/,
  );
  assert.throws(
    () =>
      anthropicResponseText({
        stop_reason: "end_turn",
        content: [{ type: "tool_use" }],
      }),
    /unexpected content block: tool_use/,
  );
  assert.throws(
    () => openAIResponseText({ choices: [] }),
    /returned no choices/,
  );
  assert.equal(
    openAIResponseText({
      choices: [
        { message: { content: "first" } },
        { message: { content: "second" } },
      ],
    }),
    "first",
  );
});
// Each protocol needs a separately configured, budget-authorized actual service.
for (const protocol of ["openai", "anthropic"])
  test(
    `live ${protocol} user simulator produces an actual bounded decision`,
    {
      skip:
        process.env.SKILLED_REAL_MODELS !== "1" ||
        process.env.SKILLED_SIMULATOR_PROTOCOL !== protocol,
      timeout: 40_000,
    },
    async () => {
      const provider = process.env.SKILLED_SIMULATOR_PROVIDER,
        model = process.env.SKILLED_SIMULATOR_MODEL;
      assert.ok(
        provider && model,
        "Set explicit simulator provider and model before enabling billable tests",
      );
      const resolver = new Resolver(process.env.SKILLED_CREDENTIALS_FILE ?? "");
      await resolver.load();
      const simulator = createSimulator(
        { provider, protocol, model, timeout_seconds: 30 },
        resolver,
      );
      const reply = await simulator.next(
        "The user only works in staging and cannot approve production changes.",
        "Answer which environment you want.",
        [
          {
            user: "Please help configure my project.",
            agent: "Which environment should I use?",
          },
        ],
        MustReply,
      );
      assert.equal(reply.action, "reply");
      assert.ok(reply.message?.trim());
    },
  );
