// Modified for the skilled TypeScript distribution.
import {
  parseAllDocuments,
  isAlias,
  isMap,
  isSeq,
  isScalar,
  visit,
  type Document,
  type Node,
} from "yaml";
import { schemaDescriptors } from "./schema.js";
// YAML string decoding uses the scalar's original spelling, unlike decoding into numbers.
const scalarSources = new WeakMap<object, Map<string, string>>();
function annotate(
  node: Node | null | undefined,
  value: unknown,
  doc: Document,
  seen = new Set<Node>(),
): void {
  if (!node || value === null || typeof value !== "object") return;
  if (isAlias(node)) {
    const target = node.resolve(doc);
    if (target && !seen.has(target)) {
      const next = new Set(seen);
      next.add(target);
      annotate(target, value, doc, next);
    }
    return;
  }
  const sources = scalarSources.get(value) ?? new Map<string, string>();
  scalarSources.set(value, sources);
  const field = (key: string, child: Node | null | undefined, v: unknown) => {
    if (isAlias(child)) {
      const resolved = child.resolve(doc);
      if (resolved) child = resolved;
    }
    if (isScalar(child) && child.source !== undefined)
      sources.set(key, child.source);
    annotate(child, v, doc, seen);
  };
  if (isSeq(node) && Array.isArray(value))
    node.items.forEach((item, i) => field(String(i), item as Node, value[i]));
  else if (isMap(node) && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      if (key === "<<") {
        if (isSeq(pair.value))
          for (const child of pair.value.items)
            annotate(child as Node, value, doc, seen);
        else annotate(pair.value as Node, value, doc, seen);
      }
    }
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      if (key !== "<<") field(key, pair.value as Node, object[key]);
    }
  }
}
export function scalarString(
  owner: object,
  key: string,
  value: unknown,
): string {
  if (typeof value === "string") return value;
  return (
    scalarSources.get(owner)?.get(key) ?? (value == null ? "" : String(value))
  );
}
// yaml.v3 treats each Unicode escape as one scalar value. UTF-16 surrogate
// escapes are invalid even when a high/low pair would form valid JSON text.
// Inspect only double-quoted CST tokens so literal backslashes in other YAML
// scalar styles, comments and escaped backslashes keep their source behavior.
function validateUnicodeEscapes(doc: Document, source: string): void {
  visit(doc, {
    Scalar(_key, node) {
      const token = node.srcToken;
      if (token?.type !== "double-quoted-scalar") return;
      const raw = token.source;
      for (let i = 1; i < raw.length - 1; i++) {
        if (raw[i] !== "\\") continue;
        const escape = raw[++i];
        if (escape !== "u" && escape !== "U") continue;
        const size = escape === "u" ? 4 : 8;
        const digits = raw.slice(i + 1, i + 1 + size);
        if (digits.length === size && /^[0-9a-fA-F]+$/.test(digits)) {
          const codePoint = Number.parseInt(digits, 16);
          if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
            const line =
              (source
                .slice(0, token.offset + i)
                .match(/\r\n|[\r\n\u0085\u2028\u2029]/g)?.length ?? 0) + 1;
            throw new Error(
              `yaml: ${line > 1 ? `line ${line}: ` : ""}found invalid Unicode character escape code`,
            );
          }
        }
        i += size;
      }
    },
  });
}
export function parseYAML(source: string): unknown {
  // yaml.v3 Unmarshal reads the first document; later documents do not change it.
  const doc = parseAllDocuments(source, {
    version: "1.2",
    uniqueKeys: true,
    merge: true,
    keepSourceTokens: true,
  })[0];
  if (!doc) return null;
  if (doc.errors.length)
    throw new Error(doc.errors.map((e) => e.message).join("\n"));
  validateUnicodeEscapes(doc, source);
  const result = doc.toJS({ maxAliasCount: 100 });
  annotate(doc.contents, result, doc);
  return result;
}
export function decode<T>(type: string, value: unknown, path = type): T {
  return decodeValue(type, value, path) as T;
}
function decodeValue(
  type: string,
  value: unknown,
  path: string,
  source?: string,
): unknown {
  if (type.startsWith("*"))
    return value == null
      ? null
      : decodeValue(type.slice(1), value, path, source);
  if (type === "any") return value ?? null;
  if (type.startsWith("[]")) {
    if (value == null) return [];
    if (!Array.isArray(value))
      throw new Error(`${path}: cannot unmarshal into sequence`);
    return value.map((v, i) =>
      decodeValue(
        type.slice(2),
        v,
        `${path}[${i}]`,
        scalarSources.get(value)?.get(String(i)),
      ),
    );
  }
  if (type === "Kwargs") type = "map[string]string";
  if (type.startsWith("map[string]")) {
    if (value == null) return {};
    if (typeof value !== "object" || Array.isArray(value))
      throw new Error(`${path}: cannot unmarshal into map`);
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        decodeValue(
          type.slice(11),
          v,
          `${path}.${k}`,
          scalarSources.get(value)?.get(k),
        ),
      ]),
    );
  }
  if (type === "string") {
    if (value == null) return "";
    if (typeof value === "object")
      throw new Error(`${path}: cannot unmarshal into string`);
    return typeof value === "string" ? value : (source ?? String(value));
  }
  if (type === "bool") {
    if (value == null) return false;
    if (typeof value === "boolean") return value;
    if (
      ["y", "Y", "yes", "Yes", "YES", "on", "On", "ON"].includes(String(value))
    )
      return true;
    if (
      ["n", "N", "no", "No", "NO", "off", "Off", "OFF"].includes(String(value))
    )
      return false;
    throw new Error(`${path}: cannot unmarshal into bool`);
  }
  if (["int", "int64", "float64"].includes(type)) {
    if (value == null) return 0;
    if (typeof value !== "number")
      throw new Error(`${path}: cannot unmarshal into ${type}`);
    let numeric = value;
    if (source && /^[-+]?0[0-7_]+$/.test(source))
      numeric = parseInt(source.replaceAll("_", ""), 8);
    if (type === "float64") return numeric;
    if (!Number.isFinite(numeric) || numeric >= 2 ** 63 || numeric < -(2 ** 63))
      throw new Error(`${path}: cannot unmarshal into ${type}`);
    return Math.trunc(numeric);
  }
  const fields = schemaDescriptors[type];
  if (!fields) throw new Error(`Unknown schema type ${type}`);
  if (value != null && (typeof value !== "object" || Array.isArray(value)))
    throw new Error(`${path}: cannot unmarshal into ${type}`);
  const input = (value ?? {}) as Record<string, unknown>;
  const result = Object.fromEntries(
    Object.entries(fields).map(([k, t]) => [
      k,
      decodeValue(
        t,
        input[k],
        `${path}.${k}`,
        scalarSources.get(input)?.get(k),
      ),
    ]),
  );
  if ("judgeSet" in fields) {
    result.judgeSet = Object.hasOwn(input, "judgeSet")
      ? input.judgeSet
      : Object.hasOwn(input, "judge");
    result.judgesSet = Object.hasOwn(input, "judgesSet")
      ? input.judgesSet
      : Object.hasOwn(input, "judges");
  }
  if (type === "MCPServer" && input.args == null) delete result.args;
  if (type === "JudgeContextConfig" && input.attachments == null)
    result.attachments = null;
  if (type === "EvalConfig" && input.skills == null) result.skills = null;
  return result;
}
