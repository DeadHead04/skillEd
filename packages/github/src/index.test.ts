import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGithubInstallState,
  downloadRepositoryZip,
  GithubApiError,
  parseGithubRepositoryUrl,
  resolveRepository,
  verifyGithubInstallState,
} from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("GitHub App adapter", () => {
  it("accepts canonical repository URLs and rejects token-like or non-GitHub inputs", () => {
    expect(
      parseGithubRepositoryUrl("https://github.com/acme/skills.git"),
    ).toEqual({
      owner: "acme",
      repository: "skills",
    });
    expect(() =>
      parseGithubRepositoryUrl("http://github.com/acme/skills"),
    ).toThrow();
    expect(() =>
      parseGithubRepositoryUrl("https://example.com/acme/skills"),
    ).toThrow();
    expect(() =>
      parseGithubRepositoryUrl("https://github.com/acme/skills/tree/main"),
    ).toThrow();
  });

  it("signs, verifies, rejects tampering, and expires installation state", () => {
    process.env.AUTH_SECRET = "integration-auth-secret-with-enough-entropy";
    const state = createGithubInstallState({
      workspaceId: "workspace",
      userId: "user",
    });
    expect(verifyGithubInstallState(state)).toEqual({
      workspaceId: "workspace",
      userId: "user",
    });
    expect(() => verifyGithubInstallState(`${state}tampered`)).toThrow(
      "Invalid",
    );
    const expired = createGithubInstallState({
      workspaceId: "workspace",
      userId: "user",
      expiresAt: Date.now() - 1,
    });
    expect(() => verifyGithubInstallState(expired)).toThrow("expired");
  });

  it("uses a short-lived installation token and resolves a ref to an immutable commit", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = "1234";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const calls: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get("authorization") });
      if (url.includes("access_tokens"))
        return Response.json({ token: "installation-token" });
      if (url.endsWith("/repos/acme/private-skills")) {
        return Response.json({ id: 99, default_branch: "main" });
      }
      return Response.json({ sha: "0123456789abcdef" });
    }) as typeof fetch;

    await expect(
      resolveRepository({
        installationId: "77",
        owner: "acme",
        repository: "private-skills",
        ref: "release/v1",
      }),
    ).resolves.toEqual({
      repositoryId: "99",
      commit: "0123456789abcdef",
      token: "installation-token",
    });
    expect(calls[1]?.authorization).toBe("Bearer installation-token");
    expect(calls[2]?.url).toContain("commits/release%2Fv1");
  });

  it("distinguishes missing repositories from missing refs", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = "1234";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("access_tokens"))
        return Response.json({ token: "token" });
      if (url.includes("/commits/")) return Response.json({}, { status: 404 });
      return Response.json({ id: 99, default_branch: "main" });
    }) as typeof fetch;
    await expect(
      resolveRepository({
        installationId: "77",
        owner: "acme",
        repository: "skills",
      }),
    ).rejects.toMatchObject({ safeCode: "REF_NOT_FOUND" });

    globalThis.fetch = vi.fn(async (input) => {
      if (String(input).includes("access_tokens"))
        return Response.json({ token: "token" });
      return Response.json({}, { status: 404 });
    }) as typeof fetch;
    await expect(
      resolveRepository({
        installationId: "77",
        owner: "acme",
        repository: "missing",
      }),
    ).rejects.toMatchObject({ safeCode: "REPOSITORY_NOT_FOUND" });
  });

  it("bounds repository archive downloads", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skilled-github-"));
    const destination = path.join(root, "archive.zip");
    globalThis.fetch = vi.fn(
      async () =>
        new Response("too large", { headers: { "content-length": "100" } }),
    ) as typeof fetch;
    await expect(
      downloadRepositoryZip({
        token: "token",
        owner: "acme",
        repository: "skills",
        commit: "abc",
        destination,
        maxBytes: 4,
      }),
    ).rejects.toBeInstanceOf(GithubApiError);
    await fs.rm(root, { recursive: true, force: true });
  });
});
