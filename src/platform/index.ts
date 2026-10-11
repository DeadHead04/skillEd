// Modified for the skilled TypeScript distribution.
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
export const bashEnvOverride = "SKILLED_BASH";
export const quotePOSIX = (value: string): string =>
  "'" + value.replaceAll("'", "'\\''") + "'";
export function quoteWindows(value: string): string {
  let out = '"',
    slashes = 0;
  for (const ch of value) {
    if (ch === "\\") {
      slashes++;
      continue;
    }
    if (ch === '"') {
      out += "\\".repeat(slashes * 2 + 1) + '"';
      slashes = 0;
      continue;
    }
    out += "\\".repeat(slashes) + ch;
    slashes = 0;
  }
  return out + "\\".repeat(slashes * 2) + '"';
}
export const quoteBashWindows = (value: string): string =>
  '"' + value.replace(/[\\"$`]/g, "\\$&") + '"';
export interface Shell {
  goos: string;
  family: "posix" | "cmd";
  bashPath?: string;
}
export function validateShell(shell: Shell): void {
  if (!shell.goos) throw new Error("shell goos must not be empty");
  if (shell.family === "posix") {
    if (shell.goos === "windows" && !shell.bashPath)
      throw new Error("windows POSIX shell requires bashPath");
  } else if (shell.family === "cmd") {
    if (shell.goos !== "windows" || shell.bashPath)
      throw new Error("cmd shell requires Windows without bashPath");
  } else throw new Error("unsupported shell family");
}
export function quoter(shell: Shell): (s: string) => string {
  validateShell(shell);
  return shell.family === "cmd"
    ? quoteWindows
    : shell.goos === "windows"
      ? quoteBashWindows
      : quotePOSIX;
}
export const isBash = (shell: Shell): boolean =>
  shell.family === "posix" && Boolean(shell.bashPath);
export function findExecutable(name: string): string | undefined {
  const extensions =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")]
      : [""];
  for (const folder of (process.env.PATH ?? "").split(path.delimiter))
    for (const ext of extensions) {
      const candidate = path.join(folder, name + ext);
      try {
        accessSync(
          candidate,
          process.platform === "win32" ? constants.F_OK : constants.X_OK,
        );
        if (statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  return undefined;
}
export function discoverBash(): string | undefined {
  const candidates = [
    process.env[bashEnvOverride],
    findExecutable("bash"),
    ...(process.platform === "win32"
      ? [
          "C:\\Program Files\\Git\\bin\\bash.exe",
          "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        ]
      : []),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (
      process.platform === "win32" &&
      path.dirname(path.resolve(candidate)).toLowerCase() ===
        path
          .join(process.env.SystemRoot ?? "C:\\Windows", "System32")
          .toLowerCase()
    )
      continue;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return undefined;
}
export interface HostShell {
  target: Shell;
  executable: string;
  args: (command: string) => string[];
  env: Record<string, string>;
}
let cached: HostShell | undefined;
export function hostShell(): HostShell {
  if (cached) return cached;
  const bash = discoverBash();
  const windows = process.platform === "win32";
  cached =
    windows && !bash
      ? {
          target: { goos: "windows", family: "cmd" },
          executable: process.env.ComSpec ?? "cmd.exe",
          args: (c) => ["/d", "/s", "/c", '"' + c + '"'],
          env: {},
        }
      : {
          target: {
            goos: windows ? "windows" : process.platform,
            family: "posix",
            bashPath: bash,
          },
          executable: bash ?? "sh",
          args: (c) => ["-c", c],
          env: windows
            ? { MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*" }
            : {},
        };
  return cached;
}
