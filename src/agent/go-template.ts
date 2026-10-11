// Modified for the skilled TypeScript distribution.
/** Go text/template interpreter for installation commands. Unsupported operations fail explicitly. */
type Value = unknown;
type Node = {
  text?: string;
  expr?: string;
  kind?: string;
  body?: Node[];
  otherwise?: Node[];
};
const truth = (v: Value): boolean =>
  Array.isArray(v) || typeof v === "string"
    ? v.length > 0
    : v && typeof v === "object"
      ? Object.keys(v).length > 0
      : !!v;
const show = (v: Value): string =>
  v === undefined
    ? "<no value>"
    : v === null
      ? "<nil>"
      : Array.isArray(v)
        ? "[" + v.map(show).join(" ") + "]"
        : v && typeof v === "object"
          ? "map[" +
            Object.keys(v)
              .sort()
              .map((k) => k + ":" + show((v as Record<string, Value>)[k]))
              .join(" ") +
            "]"
          : String(v);
function splitOutside(source: string, delimiter: string): string[] {
  const out: string[] = [];
  let from = 0,
    depth = 0,
    quote = "",
    escape = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quote) {
      if (escape) escape = false;
      else if (c === "\\" && quote !== "`") escape = true;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "`" || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      if (--depth < 0) throw new Error("unbalanced template parentheses");
    } else if (
      depth === 0 &&
      (delimiter === " " ? /\s/.test(c) : c === delimiter)
    ) {
      const part = source.slice(from, i).trim();
      if (part) out.push(part);
      from = i + 1;
    }
  }
  if (depth || quote) throw new Error("unclosed template expression");
  const last = source.slice(from).trim();
  if (last) out.push(last);
  return out;
}
export function goPrintf(format: string, ...args: Value[]): string {
  let used = 0;
  const out = format.replace(
    /%(?:\[(\d+)\])?([-+ #0]*)(\d*)(?:\.(\d+))?([%a-zA-Z])/g,
    (
      full,
      index: string,
      flags: string,
      width: string,
      precision: string,
      verb: string,
    ) => {
      if (verb === "%") return "%";
      if (index) used = Number(index) - 1;
      const a = args[used++];
      if (a === undefined) return "%!" + verb + "(MISSING)";
      let s: string;
      switch (verb) {
        case "q":
          s = JSON.stringify(typeof a === "string" ? a : show(a));
          break;
        case "s":
        case "v":
          s = show(a);
          if (precision) s = Array.from(s).slice(0, Number(precision)).join("");
          break;
        case "d":
          s = String(Math.trunc(Number(a)));
          break;
        case "f":
          s = Number(a).toFixed(precision ? Number(precision) : 6);
          break;
        case "x":
        case "X":
          s =
            typeof a === "string"
              ? Buffer.from(a).toString("hex")
              : Number(a).toString(16);
          if (verb === "X") s = s.toUpperCase();
          break;
        case "t":
          s = String(!!a);
          break;
        default:
          throw new Error("unsupported Go printf verb " + verb);
      }
      if (width) {
        const padding = Math.max(0, Number(width) - Array.from(s).length);
        s = flags.includes("-")
          ? s + " ".repeat(padding)
          : (flags.includes("0") ? "0" : " ").repeat(padding) + s;
      }
      return s;
    },
  );
  return used < args.length
    ? out +
        "%!(EXTRA " +
        args
          .slice(used)
          .map((a) => typeof a + "=" + show(a))
          .join(", ") +
        ")"
    : out;
}
export function renderGoTemplate(
  template: string,
  data: Record<string, Value>,
): string {
  const tokens = template
    .replace(/\s+{{-\s/g, "{{ ")
    .replace(/\s-}}\s+/g, " }}")
    .split(/({{[\s\S]*?}})/g);
  let index = 0;
  const definitions = new Map<string, Node[]>();
  function parse(stop = false): { nodes: Node[]; end: string } {
    const nodes: Node[] = [];
    while (index < tokens.length) {
      const t = tokens[index++]!;
      if (!t.startsWith("{{")) {
        if (t.includes("{{")) throw new Error("unclosed template action");
        nodes.push({ text: t });
        continue;
      }
      if (!t.endsWith("}}")) throw new Error("unclosed template action");
      const e = t.slice(2, -2).trim();
      if (e === "end" || e === "else" || e.startsWith("else ")) {
        if (!stop) throw new Error("unexpected " + e);
        return { nodes, end: e };
      }
      if (e.startsWith("/*") && e.endsWith("*/")) continue;
      const m = /^(if|range|with|define|block)\s+([\s\S]+)$/.exec(e);
      if (m) {
        let a = parse(true),
          b: Node[] = [];
        if (a.end.startsWith("else ")) {
          const alternate = parseElse(a.end);
          b = alternate.nodes;
          a = { nodes: a.nodes, end: alternate.end };
        } else if (a.end === "else") {
          const z = parse(true);
          b = z.nodes;
          a = { nodes: a.nodes, end: z.end };
        }
        if (a.end !== "end") throw new Error("unclosed template block");
        if (m[1] === "define" || m[1] === "block") {
          const parts = splitOutside(m[2]!, " "),
            name = JSON.parse(parts[0]!);
          definitions.set(name, a.nodes);
          if (m[1] === "block") nodes.push({ expr: "template " + m[2] });
        } else
          nodes.push({ kind: m[1], expr: m[2], body: a.nodes, otherwise: b });
      } else nodes.push({ expr: e });
    }
    return { nodes, end: "" };
  }
  function parseElse(end: string): { nodes: Node[]; end: string } {
    if (end === "else") return parse(true);
    if (!end.startsWith("else ")) return { nodes: [], end };
    const condition = /^else (if|with)\s+(.+)$/.exec(end);
    if (!condition) throw new Error("unsupported " + end);
    const branch = parse(true);
    const alternate = parseElse(branch.end);
    return {
      nodes: [
        {
          kind: condition[1],
          expr: condition[2],
          body: branch.nodes,
          otherwise: alternate.nodes,
        },
      ],
      end: alternate.end,
    };
  }
  function atom(t: string, dot: Value, vars: Record<string, Value>): Value {
    if (t[0] === "(" && t.at(-1) === ")")
      return value(t.slice(1, -1), dot, vars);
    if (t === ".") return dot;
    if (t === "$") return vars.$;
    if (t[0] === '"') return JSON.parse(t);
    if (t[0] === "`") return t.slice(1, -1);
    if (t === "true" || t === "false") return t === "true";
    if (t === "nil") return null;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (t.startsWith("."))
      return t
        .slice(1)
        .split(".")
        .reduce<Value>(
          (a, k) => (a as Record<string, Value> | undefined)?.[k],
          dot,
        );
    if (t.startsWith("$")) {
      const [name, ...keys] = t.split(".");
      if (!(name! in vars))
        throw new Error("undefined template variable " + name);
      return keys.reduce<Value>(
        (a, k) => (a as Record<string, Value> | undefined)?.[k],
        vars[name!],
      );
    }
    throw new Error("unsupported template expression " + t);
  }
  function value(expr: string, dot: Value, vars: Record<string, Value>): Value {
    const pipe = splitOutside(expr, "|");
    let v = call(pipe.shift() ?? "", [], dot, vars);
    for (const stage of pipe) v = call(stage, [v], dot, vars);
    return v;
  }
  function call(
    expr: string,
    prior: Value[],
    dot: Value,
    vars: Record<string, Value>,
  ): Value {
    const ts = splitOutside(expr, " ");
    if (
      ts.length === 1 &&
      !prior.length &&
      /^(\.|\$|"|`|\(|-?\d|true$|false$|nil$)/.test(ts[0]!)
    )
      return atom(ts[0]!, dot, vars);
    const fn = ts.shift();
    if (fn === "and" || fn === "or") {
      let last: Value;
      for (const t of ts) {
        last = atom(t, dot, vars);
        if (fn === "and" ? !truth(last) : truth(last)) return last;
      }
      return prior.length ? prior[0] : last;
    }
    const a = [...ts.map((t) => atom(t, dot, vars)), ...prior];
    switch (fn) {
      case "len":
        if (typeof a[0] === "string") return Buffer.byteLength(a[0]);
        if (a[0] == null) throw new Error("len of nil");
        return Array.isArray(a[0])
          ? a[0].length
          : Object.keys(a[0] as object).length;
      case "index":
        return a.slice(1).reduce<Value>((v, k) => {
          if (typeof v === "string") {
            const bytes = Buffer.from(v),
              i = Number(k);
            if (!Number.isInteger(i) || i < 0 || i >= bytes.length)
              throw new Error("index out of range");
            return bytes[i];
          }
          if (Array.isArray(v)) {
            const i = Number(k);
            if (!Number.isInteger(i) || i < 0 || i >= v.length)
              throw new Error("index out of range");
            return v[i];
          }
          if (v == null) throw new Error("index of nil");
          return (v as Record<string, Value>)[String(k)];
        }, a[0]);
      case "slice": {
        const target =
          typeof a[0] === "string" ? Buffer.from(a[0]) : (a[0] as Value[]);
        if (!target || (!Buffer.isBuffer(target) && !Array.isArray(target)))
          throw new Error("cannot slice value");
        if (typeof a[0] === "string" && a.length > 3)
          throw new Error("cannot three-index slice a string");
        const lo = Number(a[1] ?? 0),
          hi = Number(a[2] ?? target.length);
        if (
          !Number.isInteger(lo) ||
          !Number.isInteger(hi) ||
          lo < 0 ||
          hi < lo ||
          hi > target.length
        )
          throw new Error("slice index out of range");
        const result = target.slice(lo, hi);
        return Buffer.isBuffer(result) ? result.toString() : result;
      }
      case "eq":
        return a.slice(1).some((v) => v === a[0]);
      case "ne":
        return a[0] !== a[1];
      case "lt":
        return (a[0] as number) < (a[1] as number);
      case "le":
        return (a[0] as number) <= (a[1] as number);
      case "gt":
        return (a[0] as number) > (a[1] as number);
      case "ge":
        return (a[0] as number) >= (a[1] as number);
      case "not":
        return !truth(a[0]);
      case "print":
        return a
          .map(
            (v, i) =>
              (i > 0 && typeof a[i - 1] !== "string" && typeof v !== "string"
                ? " "
                : "") + show(v),
          )
          .join("");
      case "println":
        return a.map(show).join(" ") + "\n";
      case "printf":
        return goPrintf(String(a[0]), ...a.slice(1));
      case "html":
        return a
          .map(show)
          .join("")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&#34;")
          .replaceAll("'", "&#39;");
      case "urlquery":
        return encodeURIComponent(a.map(show).join(""))
          .replaceAll("%20", "+")
          .replace(
            /[!'()*]/g,
            (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
          );
      case "js":
        return JSON.stringify(a.map(show).join(""))
          .slice(1, -1)
          .replaceAll("<", "\\u003C")
          .replaceAll(">", "\\u003E")
          .replaceAll("&", "\\u0026");
      default:
        throw new Error("unsupported template function " + fn);
    }
  }
  const flow = { kind: "" };
  function render(
    nodes: Node[],
    dot: Value,
    vars: Record<string, Value>,
    depth = 0,
  ): string {
    if (depth > 1000) throw new Error("template recursion depth exceeded");
    let out = "";
    for (const n of nodes) {
      if (n.text !== undefined) {
        out += n.text;
        continue;
      }
      let expr = n.expr!;
      if (expr === "break" || expr === "continue") {
        flow.kind = expr;
        return out;
      }
      if (expr.startsWith("template ")) {
        const parts = splitOutside(expr.slice(9), " "),
          name = JSON.parse(parts.shift()!),
          body = definitions.get(name);
        if (!body) throw new Error("undefined template " + name);
        const input = parts.length
          ? value(parts.join(" "), dot, vars)
          : undefined;
        out += render(body, input, { $: input }, depth + 1);
        continue;
      }
      const decl = /^(\$\w+(?:\s*,\s*\$\w+)?)\s*(:=|=)\s*(.*)$/.exec(expr);
      if (decl) expr = decl[3]!;
      const v = value(expr, dot, vars);
      if (n.kind === "range") {
        const entries = Array.isArray(v)
          ? v.map((x, i) => [i, x])
          : typeof v === "number" && Number.isInteger(v)
            ? Array.from({ length: Math.max(0, v) }, (_, i) => [i, i])
            : v && typeof v === "object"
              ? Object.keys(v)
                  .sort()
                  .map((k) => [k, (v as Record<string, Value>)[k]])
              : [];
        if (!entries.length) out += render(n.otherwise ?? [], dot, vars, depth);
        for (const [key, item] of entries) {
          const next = { ...vars };
          if (decl) {
            const names = decl[1]!.split(/\s*,\s*/);
            next[names[0]!] = names.length === 1 ? item : key;
            if (names[1]) next[names[1]] = item;
          }
          out += render(n.body ?? [], item, next, depth);
          const stop = flow.kind === "break";
          flow.kind = "";
          if (stop) break;
        }
      } else if (n.kind) {
        const scoped = { ...vars };
        if (decl) scoped[decl[1]!] = v;
        out += render(
          truth(v) ? (n.body ?? []) : (n.otherwise ?? []),
          n.kind === "with" && truth(v) ? v : dot,
          scoped,
          depth,
        );
        if (flow.kind) return out;
      } else if (decl) {
        if (decl[2] === "=" && !(decl[1]! in vars))
          throw new Error("undefined template variable " + decl[1]);
        vars[decl[1]!] = v;
      } else out += show(v);
    }
    return out;
  }
  const nodes = parse().nodes;
  const result = render(nodes, data, { $: data });
  if (flow.kind) throw new Error("template " + flow.kind + " outside range");
  return result;
}
