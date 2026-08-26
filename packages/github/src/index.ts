import { createHmac, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { importPKCS8, SignJWT } from "jose";

export class GithubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly safeCode?:
      "REPOSITORY_NOT_FOUND" | "REF_NOT_FOUND" | "IMPORT_LIMIT_EXCEEDED",
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

export function parseGithubRepositoryUrl(value: string): {
  owner: string;
  repository: string;
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid GitHub repository URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com"
  ) {
    throw new Error("Repository URL must use https://github.com.");
  }
  const parts = url.pathname
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Repository URL must identify an owner and repository.");
  }
  return { owner: parts[0], repository: parts[1] };
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "SkillEd/0.1",
  };
}

function githubApiUrl(pathname: string): string {
  const testBase =
    process.env.NODE_ENV === "test"
      ? process.env.SKILLED_TEST_GITHUB_API_BASE_URL
      : undefined;
  const base = (testBase ?? "https://api.github.com").trim().replace(/\/$/, "");
  return `${base}${pathname}`;
}

async function appJwt(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !rawKey)
    throw new Error("GitHub App credentials are not configured.");
  const privateKey = await importPKCS8(rawKey.replaceAll("\\n", "\n"), "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(appId)
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 9 * 60)
    .sign(privateKey);
}

async function githubJson<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...githubHeaders(token), ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new GithubApiError(
      response.status,
      `GitHub request failed with status ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

export async function createInstallationToken(
  installationId: string,
): Promise<string> {
  const response = await githubJson<{ token: string }>(
    githubApiUrl(
      `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    ),
    await appJwt(),
    { method: "POST" },
  );
  return response.token;
}

export async function getInstallationAccount(installationId: string): Promise<{
  id: string;
  login: string;
}> {
  const installation = await githubJson<{
    account: { id: number; login?: string; slug?: string };
  }>(
    githubApiUrl(`/app/installations/${encodeURIComponent(installationId)}`),
    await appJwt(),
  );
  return {
    id: String(installation.account.id),
    login:
      installation.account.login ??
      installation.account.slug ??
      "GitHub account",
  };
}

export async function resolveRepository(input: {
  installationId: string;
  owner: string;
  repository: string;
  ref?: string;
}): Promise<{ repositoryId: string; commit: string; token: string }> {
  const token = await createInstallationToken(input.installationId);
  let repository: { id: number; default_branch: string };
  try {
    repository = await githubJson<{ id: number; default_branch: string }>(
      githubApiUrl(
        `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}`,
      ),
      token,
    );
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 404) {
      throw new GithubApiError(
        404,
        "Repository was not found.",
        "REPOSITORY_NOT_FOUND",
      );
    }
    throw error;
  }
  const reference = input.ref?.trim() || repository.default_branch;
  let commit: { sha: string };
  try {
    commit = await githubJson<{ sha: string }>(
      githubApiUrl(
        `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/commits/${encodeURIComponent(reference)}`,
      ),
      token,
    );
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 404) {
      throw new GithubApiError(
        404,
        "Reference was not found.",
        "REF_NOT_FOUND",
      );
    }
    throw error;
  }
  return { repositoryId: String(repository.id), commit: commit.sha, token };
}

export async function downloadRepositoryZip(input: {
  token: string;
  owner: string;
  repository: string;
  commit: string;
  destination: string;
  maxBytes: number;
}): Promise<void> {
  const response = await fetch(
    githubApiUrl(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/zipball/${encodeURIComponent(input.commit)}`,
    ),
    { headers: githubHeaders(input.token), redirect: "follow" },
  );
  if (!response.ok || !response.body) {
    throw new GithubApiError(
      response.status,
      `GitHub archive download failed with status ${response.status}.`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > input.maxBytes) {
    throw new GithubApiError(
      413,
      "Repository archive exceeds the import limit.",
      "IMPORT_LIMIT_EXCEEDED",
    );
  }
  await mkdir(path.dirname(input.destination), { recursive: true });
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > input.maxBytes) {
        callback(
          new GithubApiError(
            413,
            "Repository archive exceeds the import limit.",
            "IMPORT_LIMIT_EXCEEDED",
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as any),
    limiter,
    createWriteStream(input.destination, { flags: "wx" }),
  );
}

export function createGithubInstallState(input: {
  workspaceId: string;
  userId: string;
  expiresAt?: number;
}): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required.");
  const payload = Buffer.from(
    JSON.stringify({
      workspaceId: input.workspaceId,
      userId: input.userId,
      expiresAt: input.expiresAt ?? Date.now() + 10 * 60 * 1000,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGithubInstallState(state: string): {
  workspaceId: string;
  userId: string;
} {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required.");
  const [payload, signature] = state.split(".");
  if (!payload || !signature)
    throw new Error("Invalid GitHub installation state.");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    throw new Error("Invalid GitHub installation state.");
  }
  const parsed = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as {
    workspaceId: string;
    userId: string;
    expiresAt: number;
  };
  if (parsed.expiresAt < Date.now())
    throw new Error("GitHub installation state expired.");
  return { workspaceId: parsed.workspaceId, userId: parsed.userId };
}
