// Modified for the skilled TypeScript distribution.
export const builtinEngineNames = [
  "claude_code",
  "claude-code",
  "codex",
  "opencode",
  "qodercli",
  "qoder",
  "qoder-cli",
  "qwen_code",
  "qwen-code",
  "qwen",
] as const;
export function isBuiltin(name: string): boolean {
  return (builtinEngineNames as readonly string[]).includes(name);
}
export const isBuiltinEngineName = isBuiltin;
export function supportsVersion(name: string): boolean {
  return [
    "claude_code",
    "claude-code",
    "codex",
    "opencode",
    "qwen_code",
    "qwen-code",
    "qwen",
  ].includes(name);
}
const identifier = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const versionPattern = new RegExp(
  "^v?(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-" +
    identifier +
    "(?:\\." +
    identifier +
    ")*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
);
export function isExactVersion(value: string): boolean {
  return versionPattern.test(value.trim());
}
export const claudeCode = "claude_code";
export const claudeCodeAlias = "claude-code";
export const codex = "codex";
export const openCode = "opencode";
export const qoderCLI = "qodercli";
export const qoderAlias = "qoder";
export const qoderCLIAlias = "qoder-cli";
export const qwenCode = "qwen_code";
export const qwenCodeAlias = "qwen-code";
export const qwenAlias = "qwen";
