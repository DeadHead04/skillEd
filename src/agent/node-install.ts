// Modified for the skilled TypeScript distribution.
import { shellQuote } from "./base.js";
import type { Runtime, ExecOptions } from "./types.js";
const agentNodeDefaultVersion = "22";
const agentCurlConnectTimeout = "5";
const agentCurlMaxTime = "30";
const agentNVMInstallURL =
  "https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh";
const agentNVMFallbackURL =
  "https://gitee.com/mirrors/nvm/raw/v0.40.2/install.sh";
const agentNVMInstallSHA256 =
  "a909fdd01765379ebc5983674adafb8bc9de6d928bfa188761309d4a0c36be0f";
const agentNVMSource = "https://github.com/nvm-sh/nvm.git";
const agentNodeMirror = "https://nodejs.org/dist";
const agentNPMRegistry = "https://registry.npmjs.org";
const agent_npm_prefix = "${npm_config_prefix:-$HOME/.local}";
export function nodeBootstrapLines(nodeVersion = "22"): string[] {
  nodeVersion ||= "22";
  return [
    'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
    "export NVM_SYMLINK_CURRENT=true",
    'export NVM_SOURCE="${NVM_SOURCE:-' + agentNVMSource + '}"',
    'export NVM_NODEJS_ORG_MIRROR="${NVM_NODEJS_ORG_MIRROR:-' +
      agentNodeMirror +
      '}"',
    'export npm_config_registry="${npm_config_registry:-${NPM_CONFIG_REGISTRY:-' +
      agentNPMRegistry +
      '}}"',
    'agent_npm_prefix="${npm_config_prefix:-$HOME/.local}"',
    "unset npm_config_prefix",
    'if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; fi',
    'node_major="$(node -p \'process.versions.node.split(".")[0]\' 2>/dev/null || echo 0)"',
    'case "$node_major" in ""|*[!0-9]*) node_major=0;; esac',
    'if ! command -v npm >/dev/null 2>&1 || [ "$node_major" -lt ' +
      shellQuote(nodeVersion) +
      " ]; then",
    "  if ! command -v nvm >/dev/null 2>&1; then",
    '    mkdir -p "$NVM_DIR"',
    '    nvm_install_script="$(mktemp)"',
    "    curl --connect-timeout " +
      shellQuote(agentCurlConnectTimeout) +
      " --max-time " +
      shellQuote(agentCurlMaxTime) +
      " -fsSL " +
      shellQuote(agentNVMInstallURL) +
      ' -o "$nvm_install_script" || curl --connect-timeout ' +
      shellQuote(agentCurlConnectTimeout) +
      " --max-time " +
      shellQuote(agentCurlMaxTime) +
      " -fsSL " +
      shellQuote(agentNVMFallbackURL) +
      ' -o "$nvm_install_script"',
    '    if command -v sha256sum >/dev/null 2>&1; then nvm_install_sha256="$(sha256sum "$nvm_install_script" | awk \'{print $1}\')"; elif command -v shasum >/dev/null 2>&1; then nvm_install_sha256="$(shasum -a 256 "$nvm_install_script" | awk \'{print $1}\')"; else echo "sha256 checker not found" >&2; rm -f "$nvm_install_script"; exit 1; fi',
    '    if [ "$nvm_install_sha256" != ' +
      shellQuote(agentNVMInstallSHA256) +
      ' ]; then echo "nvm install checksum mismatch" >&2; rm -f "$nvm_install_script"; exit 1; fi',
    '    bash "$nvm_install_script"',
    '    rm -f "$nvm_install_script"',
    '    . "$NVM_DIR/nvm.sh"',
    "  fi",
    "  nvm install " + shellQuote(nodeVersion),
    "  nvm use " + shellQuote(nodeVersion),
    "fi",
    'if [ "$node_major" -lt ' +
      shellQuote(nodeVersion) +
      " ] && command -v nvm >/dev/null 2>&1; then nvm use " +
      shellQuote(nodeVersion) +
      "; fi",
    'export npm_config_prefix="$agent_npm_prefix"',
    'mkdir -p "$npm_config_prefix/bin"',
    'export PATH="$npm_config_prefix/bin:$PATH"',
  ];
}
export async function ensureNodeRuntime(
  rt: Runtime,
  cliBin: string,
  opts: ExecOptions = {},
): Promise<void> {
  if (!cliBin) throw new Error("ensureNodeRuntime: cliBin must not be empty");
  const command = [
    "set -e",
    "if command -v " + shellQuote(cliBin) + " >/dev/null 2>&1; then exit 0; fi",
    ...nodeBootstrapLines(),
  ].join("\n");
  let result;
  try {
    result = await rt.exec(command, opts);
  } catch (e) {
    throw new Error("node bootstrap failed: " + String(e), { cause: e });
  }
  if (result.exitCode !== 0)
    throw new Error(
      `node bootstrap failed (exit ${result.exitCode}): ${result.stderr}`,
    );
}
