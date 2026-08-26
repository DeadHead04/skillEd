import fs from "node:fs/promises";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import {
  closeDb,
  ensureIdentityWorkspace,
  getDb,
  persistSkillVersion,
  sql,
  upsertGithubConnection,
} from "@skilled/db";
import { FileSystemArtifactStore } from "@skilled/artifact-store";
import { DEFAULT_IMPORT_LIMITS } from "@skilled/domain";
import { scanSkillPackages } from "@skilled/skill-package";
import yazl from "yazl";

interface ZipEntry {
  name: string;
  content: string;
}

async function createZip(entries: ZipEntry[]): Promise<Buffer> {
  const archive = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
    });
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const entry of entries) {
    archive.addBuffer(Buffer.from(entry.content), entry.name);
  }
  archive.end();
  return completed;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to start the deterministic GitHub fixture server.");
  }
  return address.port;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 3_000),
    ),
  ]);
}

export default async function globalSetup() {
  process.env.DATABASE_URL ??=
    "postgres://skilled:skilled@127.0.0.1:54329/skilled";
  process.env.ARTIFACT_ROOT = "./artifacts/e2e";
  const stateDirectory = path.resolve("./.auth");
  await fs.mkdir(stateDirectory, { recursive: true });
  await fs.rm(path.resolve("./artifacts/e2e"), {
    recursive: true,
    force: true,
  });
  await getDb().execute(sql`
    TRUNCATE audit_events, validation_findings, import_candidates, import_jobs,
      skill_versions, skills, github_connections, workspace_members, workspaces, users
    RESTART IDENTITY CASCADE
  `);

  const populated = await ensureIdentityWorkspace({
    githubUserId: "dev-user",
    name: "Alex Smith",
    email: "dev@skilled.local",
  });
  const empty = await ensureIdentityWorkspace({
    githubUserId: "empty-user",
    name: "Empty User",
    email: "empty@skilled.local",
  });
  await upsertGithubConnection({
    workspaceId: populated.workspace.id,
    installationId: "e2e-installation",
    accountId: "4242",
    accountLogin: "acme-fixtures",
  });
  const fixtures = await scanSkillPackages(
    path.resolve("./packages/skill-package/testdata/repository"),
    DEFAULT_IMPORT_LIMITS,
  );
  const artifacts = new FileSystemArtifactStore();
  for (const candidate of fixtures) {
    const artifactKey = await artifacts.storeDirectory(
      candidate.rootPath,
      candidate.manifest.sourceChecksum,
    );
    await persistSkillVersion({
      workspaceId: populated.workspace.id,
      sourceType: "upload",
      sourceIdentity: "phase-one-reference-package",
      sourceLocator: "phase-one-reference-package",
      sourcePath: candidate.sourcePath,
      versionKey: candidate.manifest.sourceChecksum,
      name: candidate.metadata.name ?? candidate.sourcePath,
      description: candidate.metadata.description ?? "Invalid fixture",
      metadata: candidate.metadata,
      manifest: candidate.manifest,
      validationStatus: candidate.validationStatus,
      artifactKey,
      actorId: populated.user.id,
    });
  }

  const base = fixtures.find(
    (candidate) => candidate.sourcePath === "release-notes-writer",
  )!;
  const baseArtifact = await artifacts.storeDirectory(
    base.rootPath,
    base.manifest.sourceChecksum,
  );
  for (let index = 1; index <= 10; index += 1) {
    const suffix = String(index).padStart(2, "0");
    await persistSkillVersion({
      workspaceId: populated.workspace.id,
      sourceType: index % 2 === 0 ? "github" : "upload",
      sourceIdentity: `demo-source-${suffix}`,
      sourceLocator:
        index % 2 === 0
          ? `https://github.com/acme/demo-source-${suffix}`
          : `demo-source-${suffix}`,
      sourcePath: `demo-skill-${suffix}`,
      ...(index % 2 === 0 ? { sourceCommit: `${suffix}`.repeat(20) } : {}),
      versionKey: `${suffix}`.repeat(32),
      name: `demo-skill-${suffix}`,
      description: `Phase 1 catalog fixture ${suffix} for search, sorting, and pagination.`,
      metadata: {
        name: `demo-skill-${suffix}`,
        description: `Phase 1 catalog fixture ${suffix} for search, sorting, and pagination.`,
      },
      manifest: base.manifest,
      validationStatus: "valid",
      artifactKey: baseArtifact,
      actorId: populated.user.id,
    });
  }

  await fs.writeFile(
    path.join(stateDirectory, "e2e-state.json"),
    JSON.stringify({
      workspaceId: populated.workspace.id,
      emptyWorkspaceId: empty.workspace.id,
    }),
  );

  const uploadArchive = await createZip([
    {
      name: "e2e-bundle/zip-e2e-valid/SKILL.md",
      content:
        "---\nname: zip-e2e-valid\ndescription: A real browser ZIP import exercised through the SkillEd worker.\n---\n\n# ZIP E2E Skill\n\nSee [the checklist](references/checklist.md).\n",
    },
    {
      name: "e2e-bundle/zip-e2e-valid/references/checklist.md",
      content: "# Checklist\n\nThis file was persisted by the real worker.\n",
    },
    {
      name: "e2e-bundle/zip-e2e-invalid/SKILL.md",
      content:
        "---\nname: zip_e2e_invalid\ndescription: A safely inspectable invalid Skill used for candidate selection.\n---\n\n# Invalid fixture\n",
    },
  ]);
  await fs.writeFile(
    path.join(stateDirectory, "e2e-upload.zip"),
    uploadArchive,
  );

  const folderFixture = path.join(
    stateDirectory,
    "e2e-folder",
    "folder-e2e-skill",
  );
  await fs.mkdir(folderFixture, { recursive: true });
  await fs.writeFile(
    path.join(folderFixture, "SKILL.md"),
    "---\nname: folder-e2e-skill\ndescription: A real browser folder import exercised through the SkillEd worker.\n---\n\n# Folder E2E Skill\n",
  );

  const githubArchive = await createZip([
    {
      name: "acme-skills-commit/skills/github-e2e-skill/SKILL.md",
      content:
        "---\nname: github-e2e-skill\ndescription: A deterministic GitHub archive imported through the real SkillEd worker.\n---\n\n# GitHub E2E Skill\n",
    },
  ]);
  const githubCommit = "a1".repeat(20);
  const githubServer = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const json = (value: unknown, status = 200) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (
      request.method === "POST" &&
      pathname === "/app/installations/e2e-installation/access_tokens"
    ) {
      json({ token: "short-lived-e2e-installation-token" });
      return;
    }
    if (request.method === "GET" && pathname === "/repos/acme/skills") {
      json({ id: 9191, default_branch: "main" });
      return;
    }
    if (
      request.method === "GET" &&
      pathname.startsWith("/repos/acme/skills/commits/")
    ) {
      json({ sha: githubCommit });
      return;
    }
    if (
      request.method === "GET" &&
      pathname.startsWith("/repos/acme/skills/zipball/")
    ) {
      response.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": String(githubArchive.length),
      });
      response.end(githubArchive);
      return;
    }
    json({ message: "Not Found" }, 404);
  });
  const githubPort = await listen(githubServer);

  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const worker = spawn(
    process.execPath,
    ["--import", "tsx", "apps/worker/src/index.ts"],
    {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: process.env.DATABASE_URL,
        ARTIFACT_ROOT: "./artifacts/e2e",
        IMPORT_STAGING_ROOT: "./tmp/e2e-imports",
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY: privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
        SKILLED_TEST_GITHUB_API_BASE_URL: `http://127.0.0.1:${githubPort}`,
      },
      stdio: "ignore",
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (worker.exitCode !== null) {
    githubServer.close();
    throw new Error(
      "The Phase 1 import worker did not start for browser tests.",
    );
  }
  await closeDb();

  return async () => {
    await stopChild(worker);
    githubServer.closeAllConnections();
    await new Promise<void>((resolve) => githubServer.close(() => resolve()));
  };
}
