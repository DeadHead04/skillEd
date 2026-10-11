// Modified for the skilled TypeScript distribution.
/** dotenv syntax used by the original resolver: non-overriding loads and file-local expansion. */
export function parseDotenv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  let rest = source.replace(/\r\n/g, "\n");
  const expand = (v: string) =>
    v.replace(
      /(\\)?(\$)(\()?\{?([A-Z0-9_]+)?\}?/g,
      (
        match,
        escaped: string | undefined,
        _dollar: string,
        _paren: string | undefined,
        key: string | undefined,
      ) => (escaped ? match.slice(1) : key ? (values[key] ?? "") : match),
    );
  while ((rest = rest.trimStart())) {
    if (rest.startsWith("#")) {
      const i = rest.indexOf("\n");
      if (i < 0) break;
      rest = rest.slice(i + 1);
      continue;
    }
    rest = rest.replace(/^export[ \t\v\f\r\u0085\u00a0]+/, "");
    const match = /^([\p{L}\p{N}_. \t]+)[=:][ \t\v\f\r\u0085\u00a0]*/u.exec(
      rest,
    );
    if (!match)
      throw new Error(
        "unexpected character in variable name near " + JSON.stringify(rest),
      );
    const key = match[1].trimEnd();
    rest = rest.slice(match[0].length);
    let value: string;
    if (rest[0] === '"' || rest[0] === "'") {
      const quote = rest[0];
      let i = 1;
      for (; i < rest.length; i++)
        if (rest[i] === quote && rest[i - 1] !== "\\") break;
      if (i === rest.length)
        throw new Error("unterminated quoted value " + rest.split("\n")[0]);
      value = rest.slice(1, i);
      rest = rest.slice(i + 1);
      if (quote === '"')
        value = expand(
          value
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\([^$])/g, "$1"),
        );
    } else {
      let i = rest.search(/[\r\n]/);
      if (i < 0) i = rest.length;
      value = rest.slice(0, i);
      rest = rest.slice(i);
      const comment = value.search(/[ \t\v\f\r\u0085\u00a0]#/);
      if (comment >= 0) value = value.slice(0, comment);
      value = expand(value.trim());
    }
    values[key] = value;
  }
  return values;
}
