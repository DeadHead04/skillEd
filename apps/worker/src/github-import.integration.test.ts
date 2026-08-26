import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import yazl from "yazl";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  claimImportJob,
  closeDb,
  createImportJob,
  ensureIdentityWorkspace,
  getDb,
  getImportJob,
  getImportJobView,
  getSkillDetail,
  listSkills,
  selectImportCandidates,
  sql,
  upsertGithubConnection,
} from "@skilled/db";

const githubMocks = vi.hoisted(() => ({
  resolveRepository: vi.fn(),
  downloadRepositoryZip: vi.fn(),
}));

vi.mock("@skilled/github", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@skilled/github")>()),
  resolveRepository: githubMocks.resolveRepository,
  downloadRepositoryZip: githubMocks.downloadRepositoryZip,
}));

import { processImportJob } from "./processor";

const stagingRoot = path.resolve("./tmp/integration-github-imports");
const artifactRoot = path.resolve("./artifacts/integration-github");

async function writeRepositoryZip(destination: string, name: string) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const archive = new yazl.ZipFile();
  archive.addBuffer(
    Buffer.from(
      `---\nname: ${name}\ndescription: GitHub App import fixture for ${name}.\n---\n\n# ${name}\n`,
    ),
    `archive-root/${name}/SKILL.md`,
  );
  archive.end();
  const output = createWriteStream(destination);
  archive.outputStream.pipe(output);
  await finished(output);
}

beforeAll(async () => {
  process.env.IMPORT_STAGING_ROOT = stagingRoot;
  process.env.ARTIFACT_ROOT = artifactRoot;
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.rm(artifactRoot, { recursive: true, force: true });
  await getDb().execute(sql`
    TRUNCATE audit_events, validation_findings, import_candidates, import_jobs,
      skill_versions, skills, github_connections, workspace_members, workspaces, users
    RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.rm(artifactRoot, { recursive: true, force: true });
  await closeDb();
});

describe("GitHub import worker with mocked GitHub App responses", () => {
  it("imports authorized public/private repositories and pins default/ref inputs to commits", async () => {
    const identity = await ensureIdentityWorkspace({
      githubUserId: "github-integration",
      name: "GitHub User",
    });
    await upsertGithubConnection({
      workspaceId: identity.workspace.id,
      installationId: "installation-1",
      accountId: "account-1",
      accountLogin: "acme",
    });

    githubMocks.resolveRepository.mockImplementation(
      async (input: { repository: string; ref?: string }) => ({
        repositoryId:
          input.repository === "public-skills" ? "repo-public" : "repo-private",
        commit:
          input.repository === "public-skills"
            ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        token: "short-lived-installation-token",
      }),
    );
    githubMocks.downloadRepositoryZip.mockImplementation(
      async (input: { repository: string; destination: string }) => {
        await writeRepositoryZip(
          input.destination,
          input.repository === "public-skills"
            ? "public-skill"
            : "private-skill",
        );
      },
    );

    const jobs = await Promise.all([
      createImportJob({
        workspaceId: identity.workspace.id,
        sourceType: "github",
        source: {
          type: "github",
          repositoryUrl: "https://github.com/acme/public-skills",
          owner: "acme",
          repository: "public-skills",
        },
        createdBy: identity.user.id,
      }),
      createImportJob({
        workspaceId: identity.workspace.id,
        sourceType: "github",
        source: {
          type: "github",
          repositoryUrl: "https://github.com/acme/private-skills",
          owner: "acme",
          repository: "private-skills",
          ref: "v1.2.0",
        },
        createdBy: identity.user.id,
      }),
    ]);

    for (const job of jobs) {
      const claimed = await claimImportJob();
      expect(claimed?.id).toBe(job.id);
      await processImportJob(claimed!);
      const view = await getImportJobView(identity.workspace.id, job.id);
      expect(view?.state).toBe("awaiting_selection");
      await expect(
        selectImportCandidates(identity.workspace.id, job.id, [
          view!.candidates[0]!.id,
        ]),
      ).resolves.toBe("accepted");
      await processImportJob(
        (await getImportJob(identity.workspace.id, job.id))!,
      );
    }

    expect(githubMocks.resolveRepository).toHaveBeenNthCalledWith(
      1,
      expect.not.objectContaining({ ref: expect.anything() }),
    );
    expect(githubMocks.resolveRepository).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ref: "v1.2.0" }),
    );
    const catalog = await listSkills(identity.workspace.id, {
      source: "github",
      sort: "name_asc",
      page: 1,
      pageSize: 12,
    });
    expect(catalog.items.map((item) => item.skill.name)).toEqual([
      "private-skill",
      "public-skill",
    ]);
    const publicDetail = await getSkillDetail(
      identity.workspace.id,
      catalog.items.find((item) => item.skill.name === "public-skill")!.skill
        .id,
    );
    const privateDetail = await getSkillDetail(
      identity.workspace.id,
      catalog.items.find((item) => item.skill.name === "private-skill")!.skill
        .id,
    );
    expect(publicDetail?.version.sourceCommit).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(privateDetail?.version.sourceCommit).toBe(
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    expect(JSON.stringify(catalog)).not.toContain(
      "short-lived-installation-token",
    );
  });
});
