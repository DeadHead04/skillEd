// Modified for the skilled TypeScript distribution.
import { RE2 } from "re2-wasm";
export interface GoRegexMatch extends Array<string | undefined> {
  index: number;
  input: string;
  groups?: Record<string, string>;
}
/** Uses RE2 with Go syntax, capture numbering and duplicate capture-name support. */
export class GoRegex {
  readonly source: string;
  readonly subexpNames: string[] = [""];
  private readonly engine: RE2;
  constructor(pattern: string) {
    this.source = pattern;
    let translated = "",
      inClass = false,
      quoted = false;
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "\\") {
        const next = pattern[++i];
        if (next === undefined) {
          translated += "\\";
          break;
        }
        if (quoted) {
          if (next === "E") quoted = false;
        } else if (next === "Q") quoted = true;
        else if (next === "C" || next === "u")
          throw new Error(
            `error parsing regexp: invalid escape sequence: \`\\${next}\``,
          );
        translated += "\\" + next;
        continue;
      }
      if (quoted) {
        translated += c;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      if (c === "(" && !inClass) {
        const rest = pattern.slice(i);
        const named = /^\(\?(?:P)?<([^>]*)>/.exec(rest);
        if (named) {
          if (!/^[A-Za-z0-9_]+$/.test(named[1]))
            throw new Error("error parsing regexp: invalid named capture");
          this.subexpNames.push(named[1]);
          translated += "(";
          i += named[0].length - 1;
          continue;
        }
        if (pattern[i + 1] !== "?") this.subexpNames.push("");
      }
      translated += c;
    }
    this.engine = new RE2(translated, "u");
  }
  test(value: string): boolean {
    return this.engine.test(value);
  }
  exec(value: string): GoRegexMatch | null {
    const matched = this.engine.exec(value);
    if (!matched) return null;
    const result = matched as GoRegexMatch;
    const groups: Record<string, string> = {};
    for (let i = 1; i < this.subexpNames.length; i++) {
      const name = this.subexpNames[i];
      if (name && !Object.hasOwn(groups, name)) groups[name] = matched[i] ?? "";
    }
    if (Object.keys(groups).length) result.groups = groups;
    return result;
  }
}
export function compileRegex(pattern: string): GoRegex {
  return new GoRegex(pattern);
}
export function regexMatches(pattern: string, value: string): boolean {
  return compileRegex(pattern).test(value);
}
export function regexError(pattern: string): string | undefined {
  try {
    compileRegex(pattern);
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
