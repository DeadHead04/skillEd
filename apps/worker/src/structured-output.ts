type Schema = Record<string, any>;

// Codex requires every object property in `required`. Optional application
// fields use null on the wire and are restored before original Zod validation.
export function codexOutputSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(codexOutputSchema);
  if (!value || typeof value !== "object") return value;
  const schema = value as Schema;
  const result = Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => key !== "default")
      .map(([key, item]) => [key, codexOutputSchema(item)]),
  ) as Schema;
  if (schema.properties) {
    const required = new Set<string>(schema.required ?? []);
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, item]) => [
        key,
        required.has(key)
          ? codexOutputSchema(item)
          : { anyOf: [codexOutputSchema(item), { type: "null" }] },
      ]),
    );
    result.required = Object.keys(schema.properties);
    result.additionalProperties = false;
  }
  return result;
}

function permitsNull(schema: Schema): boolean {
  return (
    schema.type === "null" ||
    (Array.isArray(schema.type) && schema.type.includes("null")) ||
    schema.enum?.includes(null) ||
    schema.anyOf?.some(permitsNull) ||
    schema.oneOf?.some(permitsNull) ||
    false
  );
}

export function restoreOptionalFields(value: unknown, original: unknown): any {
  const schema = original as Schema | undefined;
  if (!schema || !value || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => restoreOptionalFields(item, schema.items));
  const objectSchema = schema.properties
    ? schema
    : (schema.anyOf ?? schema.oneOf)?.find((item: Schema) => item.properties);
  if (!objectSchema) return value;
  const required = new Set<string>(objectSchema.required ?? []);
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const property = objectSchema.properties[key];
      if (
        property &&
        item === null &&
        !required.has(key) &&
        !permitsNull(property)
      )
        return [];
      return [[key, restoreOptionalFields(item, property)]];
    }),
  );
}
