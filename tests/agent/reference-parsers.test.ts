import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseStreamOutput,
  parseSessionFile,
} from "../../src/agent/claude-code.js";
import {
  parseCodexOutput,
  parseCodexSessionFile,
} from "../../src/agent/codex.js";
import { parseQwenSessionFile } from "../../src/agent/qwen-code.js";
import { parseQoderSessionID } from "../../src/agent/qodercli.js";
import { parseOpenCodeEvents } from "../../src/agent/opencode.js";
import type { Transcript } from "../../src/contracts/transcript.js";

const vectors: {
  kind: string;
  input: string | { output: string; instruction: string };
  output: unknown;
}[] = JSON.parse(
  gunzipSync(
    await readFile(
      new URL(
        "../../../tests/agent/reference-parsers.json.gz",
        import.meta.url,
      ),
    ),
  ).toString(),
);
type Parsed = {
  transcript: Transcript;
  finalMsg: string;
  inputTokens: number;
  outputTokens: number;
};
function four(value: Parsed) {
  return {
    transcript: value.transcript.length ? value.transcript : null,
    final_message: value.finalMsg,
    input_tokens: value.inputTokens,
    output_tokens: value.outputTokens,
  };
}
// These are pure production-parser comparisons against original Go outputs, not
// evidence that an authenticated model or its external CLI has executed.
for (const [index, vector] of vectors.entries())
  test(`original Go parser ${index + 1}: ${vector.kind}`, async () => {
    let result: unknown;
    let temporary: string | undefined;
    async function file() {
      temporary = await mkdtemp(join(tmpdir(), "skilled-parser-"));
      const path = join(temporary, "session.jsonl");
      await writeFile(path, vector.input as string);
      return path;
    }
    try {
      switch (vector.kind) {
        case "claude_stream":
          result = four(parseStreamOutput(vector.input as string));
          break;
        case "claude_session":
          result = four(await parseSessionFile(await file()));
          break;
        case "qwen_session":
          result = four(await parseQwenSessionFile(await file()));
          break;
        case "qoder_session_id":
          result = parseQoderSessionID(vector.input as string);
          break;
        case "codex_stream": {
          const parsed = parseCodexOutput(vector.input as string);
          result = {
            ...four(parsed),
            thread_id: parsed.threadID,
            error: parsed.error?.message || "",
          };
          break;
        }
        case "codex_session": {
          const parsed = await parseCodexSessionFile(await file());
          result = { ...four(parsed), error: parsed.error?.message || "" };
          break;
        }
        case "opencode": {
          const input = vector.input as { output: string; instruction: string };
          const parsed = parseOpenCodeEvents(input.output, input.instruction);
          result = { result: parsed.result, event_error: parsed.eventError };
          break;
        }
        default:
          throw new Error(`Unknown oracle kind ${vector.kind}`);
      }
      assert.deepEqual(JSON.parse(JSON.stringify(result)), vector.output);
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  });
