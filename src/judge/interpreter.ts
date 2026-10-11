// Modified for the skilled TypeScript distribution.
import { open } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  quoter,
  validateShell,
  isBash,
  quotePOSIX,
  type Shell,
} from "../platform/index.js";
export interface ScriptPlan {
  uploadName: string;
  command: (remoteScript: string) => string;
  cleanupCommand: (dir: string) => string;
  envPath: (p: string) => string;
}
export const identityEnvPath = (p: string) => p;
export const shebangPOSIXShells = new Set(["sh", "bash"]);
export const psInterpCore = "pwsh",
  psInterpLegacy = "powershell";
export async function planScript(
  scriptPath: string,
  shell: Shell,
): Promise<ScriptPlan> {
  try {
    validateShell(shell);
  } catch (e) {
    throw new Error(`invalid runtime shell: ${(e as Error).message}`, {
      cause: e,
    });
  }
  if (shell.goos !== "windows")
    return {
      uploadName: "script",
      command: (p) => `chmod 700 ${quotePOSIX(p)} && ${quotePOSIX(p)}`,
      cleanupCommand: (p) => "rm -rf " + quotePOSIX(p),
      envPath: identityEnvPath,
    };
  return planWindowsScript(scriptPath, shell);
}
export async function planWindowsScript(
  scriptPath: string,
  shell: Shell,
): Promise<ScriptPlan> {
  const quote = quoter(shell);
  const { interpreter, options } = parseShebang(await readShebang(scriptPath));
  const ext =
    path.extname(scriptPath).toLowerCase() ||
    extensionForShebangInterpreter(interpreter);
  const cleanupCommand = (dir: string) => "cmd /d /s /c rd /s /q " + quote(dir);
  switch (ext) {
    case ".ps1": {
      const args = [
        interpreter === psInterpCore ? psInterpCore : psInterpLegacy,
        ...([psInterpCore, psInterpLegacy].includes(interpreter)
          ? options.map(quote)
          : []),
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
      ];
      return {
        uploadName: "script.ps1",
        command: (p) => [...args, quote(p)].join(" "),
        cleanupCommand,
        envPath: identityEnvPath,
      };
    }
    case ".cmd":
    case ".bat":
      return {
        uploadName: "script" + ext,
        command: (p) => "cmd /d /s /c " + quote(p),
        cleanupCommand,
        envPath: identityEnvPath,
      };
    case ".sh":
    case ".bash": {
      if (!isBash(shell))
        throw new Error(
          "script judge: .sh script requires a bash target shell on Windows",
        );
      const slash = (p: string) => p.replaceAll("\\", "/");
      const args = [
        quote(shell.bashPath ?? ""),
        ...(shebangPOSIXShells.has(interpreter) ? options.map(quote) : []),
      ];
      return {
        uploadName: "script.sh",
        command: (p) => [...args, quote(slash(p))].join(" "),
        cleanupCommand: (p) => "rm -rf " + quote(slash(p)),
        envPath: slash,
      };
    }
    default:
      throw new Error(
        `script judge: cannot determine interpreter for ${path.basename(scriptPath)} on Windows: add a .sh, .ps1, or .cmd extension or a shebang`,
      );
  }
}
export function judgeTempDir(goos: string): string {
  const name = "skilled-judge-" + process.hrtime.bigint();
  return goos === "windows"
    ? path.join(os.tmpdir(), name)
    : path.posix.join("/tmp", name);
}
export function joinForGOOS(goos: string, ...elements: string[]): string {
  return goos === "windows"
    ? path.join(...elements)
    : path.posix.join(...elements);
}
export function extensionForShebangInterpreter(interpreter: string): string {
  return [psInterpCore, psInterpLegacy].includes(interpreter)
    ? ".ps1"
    : shebangPOSIXShells.has(interpreter)
      ? ".sh"
      : "";
}
export async function shebangExtension(file: string): Promise<string> {
  return extensionForShebangInterpreter(
    parseShebang(await readShebang(file)).interpreter,
  );
}
export async function readShebang(file: string): Promise<string> {
  let handle;
  try {
    handle = await open(file, "r");
    const data = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(data, 0, data.length, 0);
    const bytes = data.subarray(0, bytesRead);
    const end = bytes.indexOf(10);
    if (end < 0 && bytesRead === 65536) return "";
    const line = bytes
      .subarray(0, end < 0 ? bytesRead : end)
      .toString()
      .trim();
    return line.startsWith("#!") ? line.slice(2) : "";
  } catch {
    return "";
  } finally {
    await handle?.close();
  }
}
export interface Shebang {
  interpreter: string;
  options: string[];
}
const empty = (): Shebang => ({ interpreter: "", options: [] });
const fields = (s: string) => (s.trim() ? s.trim().split(/\s+/u) : []);
export function parseShebang(body: string): Shebang {
  const f = fields(body);
  if (!f.length) return empty();
  if (path.basename(f[0]) === "env") return parseEnvShebang(f.slice(1));
  return { interpreter: path.basename(f[0]), options: f.slice(1) };
}
export const isEnvAssignment = (s: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*=/.test(s);
export function interpreterFromArgs(args: string[]): Shebang {
  let i = 0;
  while (i < args.length && isEnvAssignment(args[i])) i++;
  return i === args.length
    ? empty()
    : { interpreter: path.basename(args[i]), options: args.slice(i + 1) };
}
export function parseEnvShebang(args: string[]): Shebang {
  for (let i = 0; i < args.length;) {
    const f = args[i];
    if (f === "-S" || f === "--split-string")
      return splitStringInterpreter(args.slice(i + 1).join(" "));
    if (f.startsWith("--split-string=") || f.startsWith("-S")) {
      const rest = f.startsWith("--split-string=") ? f.slice(15) : f.slice(2);
      return splitStringInterpreter(
        [rest, ...args.slice(i + 1)].filter(Boolean).join(" "),
      );
    }
    if (["-u", "-C", "-a", "--unset", "--chdir", "--argv0"].includes(f)) i += 2;
    else if (f.startsWith("-")) i++;
    else return interpreterFromArgs(args.slice(i));
  }
  return empty();
}
export function splitStringInterpreter(body: string): Shebang {
  try {
    return interpreterFromArgs(tokenizeShebangSplitString(body));
  } catch {
    return empty();
  }
}
export function tokenizeShebangSplitString(body: string): string[] {
  const tokens: string[] = [];
  let cur = "",
    single = false,
    double = false,
    started = false;
  const flush = () => {
    if (started) {
      tokens.push(cur);
      cur = "";
      started = false;
    }
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i],
      next = body[i + 1];
    if (single) {
      if (c === "'") single = false;
      else cur += c;
      started = true;
    } else if (double) {
      if (c === '"') double = false;
      else if (c === "\\" && (next === '"' || next === "\\")) {
        cur += next;
        i++;
      } else cur += c;
      started = true;
    } else if (/[ \t\n\v\r\f]/.test(c)) flush();
    else if (c === "'") {
      single = true;
      started = true;
    } else if (c === '"') {
      double = true;
      started = true;
    } else if (c === "\\") {
      if (!next) continue;
      if (next === "c") {
        flush();
        break;
      }
      if ("_tnrvf".includes(next)) flush();
      else {
        cur += next;
        started = true;
      }
      i++;
    } else {
      cur += c;
      started = true;
    }
  }
  if (single || double)
    throw new Error(
      `unterminated quote in shebang -S body: ${JSON.stringify(body)}`,
    );
  flush();
  return tokens;
}
