import { describe, expect, it } from "vitest";
import { parseCatalogQuery } from "./catalog";

describe("parseCatalogQuery", () => {
  it("accepts only supported catalog values", () => {
    expect(
      parseCatalogQuery({
        q: "  writer  ",
        validation: "warning",
        source: "github",
        sort: "name_desc",
        page: "2",
        pageSize: "24",
      }),
    ).toEqual({
      q: "writer",
      validation: "warning",
      source: "github",
      sort: "name_desc",
      page: 2,
      pageSize: 24,
    });
  });

  it("falls back safely for unsupported values", () => {
    expect(
      parseCatalogQuery({
        validation: "admin",
        source: "all",
        page: "-4",
        pageSize: "500",
      }),
    ).toEqual({
      sort: "recent",
      page: 1,
      pageSize: 12,
    });
  });
});
