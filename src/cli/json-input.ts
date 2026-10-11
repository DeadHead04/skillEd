// Modified for the skilled TypeScript distribution.
import { jsonSchemas } from "./json-schema.js";
const members = Symbol("ordered JSON members");
class JSONNumber {
  constructor(readonly raw: string) {}
}
type JSONObject = Record<string, unknown> & { [members]?: [string, unknown][] };
/** JSON.parse validates syntax; retaining object entry order also preserves Go's null-on-scalar behavior for duplicate keys. */
function parseOrderedJSON(text: string): unknown {
  JSON.parse(text);
  const tokens =
    text.match(
      /"(?:[^"\\]|\\.)*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]/gs,
    ) ?? [];
  let at = 0;
  function value(): unknown {
    const token = tokens[at++];
    if (token === "{") {
      const object: JSONObject = Object.create(null),
        entries: [string, unknown][] = [];
      while (tokens[at] !== "}") {
        const key = JSON.parse(tokens[at++]) as string;
        at++;
        const v = value();
        entries.push([key, v]);
        Object.defineProperty(object, key, {
          value: v,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        if (tokens[at] !== ",") break;
        at++;
      }
      at++;
      Object.defineProperty(object, members, { value: entries });
      return object;
    }
    if (token === "[") {
      const arr: unknown[] = [];
      while (tokens[at] !== "]") {
        arr.push(value());
        if (tokens[at] !== ",") break;
        at++;
      }
      at++;
      return arr;
    }
    return /^-?\d/.test(token) ? new JSONNumber(token) : JSON.parse(token);
  }
  return value();
}
function zero(type: string): unknown {
  if (
    type.startsWith("*") ||
    type.startsWith("[]") ||
    type.startsWith("map:") ||
    type === "any"
  )
    return null;
  if (type === "time.Time") return "0001-01-01T00:00:00Z";
  if (type === "string") return "";
  if (type === "bool") return false;
  if (["int", "int64", "float64"].includes(type)) return 0;
  const schema = jsonSchemas[type];
  if (!schema) throw new Error(`unsupported JSON type ${type}`);
  if (schema.alias) return zero(schema.alias);
  return Object.fromEntries(
    (schema.fields ?? []).map((f) => [f.target, zero(f.type)]),
  );
}
function decodeJSON(
  type: string,
  value: unknown,
  previous: unknown = zero(type),
  location = type,
): unknown {
  if (type.startsWith("*"))
    return value == null
      ? null
      : decodeJSON(
          type.slice(1),
          value,
          previous ?? zero(type.slice(1)),
          location,
        );
  if (value === null)
    return type.startsWith("[]") || type.startsWith("map:") || type === "any"
      ? null
      : previous;
  if (type === "any") {
    if (value instanceof JSONNumber) {
      const number = Number(value.raw);
      if (!Number.isFinite(number))
        throw new Error(`${location} number is out of range`);
      return number;
    }
    if (Array.isArray(value)) return value.map((v) => decodeJSON("any", v));
    if (typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, decodeJSON("any", v)]),
      );
    return value;
  }
  if (type.startsWith("[]")) {
    if (!Array.isArray(value)) throw new Error(`${location} must be an array`);
    return value.map((v, i) =>
      decodeJSON(type.slice(2), v, undefined, `${location}[${i}]`),
    );
  }
  if (type.startsWith("map:")) {
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      value instanceof JSONNumber
    )
      throw new Error(`${location} must be an object`);
    return Object.fromEntries(
      Object.entries(value as object).map(([k, v]) => [
        k,
        decodeJSON(type.slice(4), v, undefined, `${location}.${k}`),
      ]),
    );
  }
  if (type === "time.Time") {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) ||
      !Number.isFinite(Date.parse(value.replace(",", ".")))
    )
      throw new Error(`${location} must be an RFC3339 timestamp`);
    return value.replace(",", ".");
  }
  if (type === "string" || type === "bool") {
    if (typeof value !== (type === "bool" ? "boolean" : "string"))
      throw new Error(
        `${location} must be ${type === "bool" ? "boolean" : "a string"}`,
      );
    return value;
  }
  if (["int", "int64", "float64"].includes(type)) {
    const number = value instanceof JSONNumber ? Number(value.raw) : value;
    if (
      typeof number !== "number" ||
      !Number.isFinite(number) ||
      (type !== "float64" &&
        ((value instanceof JSONNumber && !/^-?\d+$/.test(value.raw)) ||
          !Number.isInteger(number) ||
          number >= 2 ** 63 ||
          number < -(2 ** 63)))
    )
      throw new Error(
        `${location} must be ${type === "float64" ? "a number" : "an integer"}`,
      );
    return number;
  }
  const schema = jsonSchemas[type];
  if (!schema) throw new Error(`unsupported JSON type ${type}`);
  if (schema.alias) return decodeJSON(schema.alias, value, previous, location);
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof JSONNumber
  )
    throw new Error(`${location} must be an object`);
  const out = previous as Record<string, unknown>,
    object = value as JSONObject;
  for (const [key, v] of object[members] ?? Object.entries(object)) {
    const field =
      schema.fields?.find((f) => f.name === key) ??
      schema.fields?.find((f) => f.name.toUpperCase() === key.toUpperCase());
    if (field)
      Object.defineProperty(out, field.target, {
        value: decodeJSON(
          field.type,
          v,
          out[field.target],
          `${location}.${field.target}`,
        ),
        writable: true,
        enumerable: true,
        configurable: true,
      });
  }
  return out;
}
function omitEmpty(type: string, value: unknown): unknown {
  if (value == null) return value;
  if (type.startsWith("*")) return omitEmpty(type.slice(1), value);
  if (type.startsWith("[]"))
    return (value as unknown[]).map((v) => omitEmpty(type.slice(2), v));
  if (type.startsWith("map:")) return value;
  const schema = jsonSchemas[type];
  if (!schema) return value;
  if (schema.alias) return omitEmpty(schema.alias, value);
  const object = value as Record<string, unknown>,
    out: Record<string, unknown> = {};
  for (const f of schema.fields ?? []) {
    const v = object[f.target];
    if (
      f.optional &&
      (f.type.startsWith("*")
        ? v == null
        : v == null ||
          v === "" ||
          v === 0 ||
          v === false ||
          (Array.isArray(v) && v.length === 0) ||
          (f.type.startsWith("map:") && Object.keys(v as object).length === 0))
    )
      continue;
    out[f.target] = omitEmpty(f.type, v);
  }
  return out;
}
export function parseJSONInput<T>(
  type: string,
  text: string,
  compact = false,
): T {
  const value = decodeJSON(type, parseOrderedJSON(text));
  return (compact ? omitEmpty(type, value) : value) as T;
}
