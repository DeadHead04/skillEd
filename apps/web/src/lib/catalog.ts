import type { CatalogQuery } from "@skilled/db";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseCatalogQuery(
  input: Record<string, string | string[] | undefined>,
): CatalogQuery {
  const validationInput = first(input.validation);
  const sourceInput = first(input.source);
  const sortInput = first(input.sort);
  const pageInput = Number(first(input.page) ?? 1);
  const pageSizeInput = Number(first(input.pageSize) ?? 12);
  return {
    ...(first(input.q)?.trim()
      ? { q: first(input.q)!.trim().slice(0, 200) }
      : {}),
    ...(validationInput === "valid" ||
    validationInput === "warning" ||
    validationInput === "invalid"
      ? { validation: validationInput }
      : {}),
    ...(sourceInput === "github" || sourceInput === "upload"
      ? { source: sourceInput }
      : {}),
    sort:
      sortInput === "name_asc" || sortInput === "name_desc"
        ? sortInput
        : "recent",
    page: Number.isInteger(pageInput) && pageInput > 0 ? pageInput : 1,
    pageSize: pageSizeInput === 24 || pageSizeInput === 48 ? pageSizeInput : 12,
  };
}
