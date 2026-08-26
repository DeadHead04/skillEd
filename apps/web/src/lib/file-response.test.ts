import { describe, expect, it } from "vitest";
import { safeFileHeaders } from "./file-response";

describe("safe file response headers", () => {
  it("permits bounded safe text as inert inline content", () => {
    const headers = safeFileHeaders({
      relativePath: "references/guide.md",
      mediaType: "text/markdown; charset=utf-8",
      inline: true,
    });
    expect(headers["Content-Type"]).toBe("text/markdown; charset=utf-8");
    expect(headers["Content-Disposition"]).toContain("inline");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Security-Policy"]).toContain("sandbox");
  });

  it("forces binaries, active content, and requested downloads to attachment", () => {
    const headers = safeFileHeaders({
      relativePath: "scripts/payload.js",
      mediaType: "application/octet-stream",
      inline: false,
    });
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers["Content-Disposition"]).toBe(
      "attachment; filename*=UTF-8''payload.js",
    );
  });
});
