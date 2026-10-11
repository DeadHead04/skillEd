// Modified for the skilled TypeScript distribution.
import path from "node:path";
import { context } from "@opentelemetry/api";
import { persistRuntimeArtifact, writeLocalArtifact } from "./base.js";
import { infoContextf } from "../logging/index.js";
import type { Runtime, ExecOptions, PromptDeliveryMetadata } from "./types.js";
export function promptInlineMaxBytes(): number {
  const raw = process.env.SKILLED_PROMPT_INLINE_MAX_BYTES;
  if (!raw || !/^\+?\d+$/.test(raw)) return 32768;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : 32768;
}
export async function deliverPrompt(
  rt: Runtime,
  opts: ExecOptions,
  instruction: string,
  builder: {
    inline?: (text: string) => string;
    stdinFile?: (file: string) => string;
  },
): Promise<{ command: string; metadata: PromptDeliveryMetadata }> {
  const threshold = promptInlineMaxBytes();
  const metadata: PromptDeliveryMetadata = {
    mode: "inline",
    prompt_bytes: Buffer.byteLength(instruction),
    inline_max_bytes: threshold,
  };
  if (!builder.inline)
    throw new Error("prompt delivery requires inline command builder");
  if (metadata.prompt_bytes <= threshold)
    return { command: builder.inline(instruction), metadata };
  if (!builder.stdinFile)
    throw new Error(
      `prompt delivery requires stdin file command builder for ${metadata.prompt_bytes}-byte prompt above ${threshold}-byte inline threshold`,
    );
  if (!rt) throw new Error("prompt delivery requires runtime for file mode");
  const runtimePath = path.join(
    rt.workspace(),
    ".skilled",
    "prompts",
    "prompt.txt",
  );
  await persistRuntimeArtifact(rt, runtimePath, instruction, opts.signal);
  metadata.prompt_path = opts.artifactDir
    ? await writeLocalArtifact(opts.artifactDir, "prompt.txt", instruction)
    : "";
  metadata.mode = "file";
  metadata.runtime_path = runtimePath;
  infoContextf(
    opts.context ?? context.active(),
    "prompt delivery mode=file bytes=%d threshold=%d",
    metadata.prompt_bytes,
    threshold,
  );
  return { command: builder.stdinFile(runtimePath), metadata };
}
