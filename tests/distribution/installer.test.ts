import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  stat,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../../../", import.meta.url));
async function run(
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: cwd,
        OTEL_TRACES_EXPORTER: "none",
        OTEL_METRICS_EXPORTER: "none",
        ...env,
      },
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
const releaseVersion = (
  JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    version: string;
  }
).version;
const enabled = process.env.SKILLED_INSTALLER_INTEGRATION === "1";
test("installer refuses a malformed repository override", async (t) => {
  const dir = await mkdtemp(
    path.join(tmpdir(), "skilled-install-invalid-destination-"),
  );
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = await run(["bash", path.join(root, "install.sh")], dir, {
    SKILLED_REPOSITORY: "invalid repository",
    SKILLED_RELEASE_BASE_URL: "",
    SKILLED_VERSION: releaseVersion,
  });
  assert.equal(out.code, 1);
  assert.match(out.stderr, /invalid SKILLED_REPOSITORY/);
});
test("installer resolves its default repository before validating the version", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "skilled-install-default-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = await run(["bash", path.join(root, "install.sh")], dir, {
    SKILLED_REPOSITORY: "",
    SKILLED_RELEASE_BASE_URL: "",
    SKILLED_VERSION: "invalid version",
  });
  assert.equal(out.code, 1);
  assert.match(out.stderr, /invalid or unresolved release version/);
  assert.doesNotMatch(out.stdout, /Downloading/);
});
test("installer rejects conflicting authenticated download settings before network access", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "skilled-install-gh-settings-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const settings of [
    { SKILLED_USE_GH: "invalid" },
    { SKILLED_USE_GH: "1", SKILLED_RELEASE_BASE_URL: "https://example.invalid/releases" },
    { SKILLED_USE_GH: "1", SKILLED_LATEST_VERSION_URL: "https://example.invalid/latest" },
  ]) {
    const out = await run(["bash", path.join(root, "install.sh")], dir, settings);
    assert.equal(out.code, 1);
    assert.match(out.stderr, /SKILLED_USE_GH (must be 0 or 1|cannot be combined)/);
    assert.doesNotMatch(out.stdout, /Downloading/);
  }
});
test(
  "authenticated GitHub release installation and latest reinstall execute the published CLI",
  {
    skip: process.env.SKILLED_GITHUB_INSTALLER_INTEGRATION === "1"
      ? false
      : "enable SKILLED_GITHUB_INSTALLER_INTEGRATION=1 after publishing a release and authenticating gh",
    timeout: 420000,
  },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "skilled-install-github-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const bin = path.join(dir, "installed cli", "bin");
    // Reuse the user's actual gh login while keeping the installation HOME isolated.
    // Credentials remain in gh's existing storage and never enter release artifacts.
    const authEnv: NodeJS.ProcessEnv = {
      GH_CONFIG_DIR: process.env.GH_CONFIG_DIR ?? path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME!, ".config"),
        "gh",
      ),
      GH_TOKEN: process.env.GH_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GH_HOST: process.env.GH_HOST,
      GH_PROMPT_DISABLED: "1",
      SKILLED_USE_GH: "1",
      SKILLED_REPOSITORY: process.env.SKILLED_GITHUB_INSTALLER_REPOSITORY ?? "DeadHead04/skillEd",
      INSTALL_DIR: bin,
    };
    const launcher = path.join(bin, "skilled");
    let wrapper = "";
    for (const version of [releaseVersion, "latest"]) {
      const installed = await run(["bash", path.join(root, "install.sh")], dir, {
        ...authEnv,
        SKILLED_VERSION: version,
      });
      assert.equal(installed.code, 0, installed.stdout + installed.stderr);
      assert.match(installed.stdout, /with GitHub CLI/);
      const actual = await run([launcher, "--version"], dir);
      assert.equal(actual.code, 0, actual.stderr);
      assert.equal(actual.stdout, `skilled version ${releaseVersion}\n`);
      const initialized = await run([launcher, "init", "--print"], dir);
      assert.equal(initialized.code, 0, initialized.stderr);
      assert.match(initialized.stdout, /kind: SkilledConfig/);
      const help = await run([launcher, "run", "--help"], dir);
      assert.equal(help.code, 0, help.stderr);
      assert.match(help.stdout, /--event-log/);
      const currentWrapper = await readFile(launcher, "utf8");
      if (wrapper) assert.equal(currentWrapper, wrapper);
      wrapper = currentWrapper;
    }
  },
);
test(
  "real HTTP release installation, CLI execution, reinstall, latest resolution and corruption protection",
  {
    skip: enabled
      ? false
      : "enable SKILLED_INSTALLER_INTEGRATION=1 with a real bundled release",
    timeout: 420000,
  },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "skilled-installer-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const version = releaseVersion,
      archive =
        process.env.SKILLED_INSTALLER_ARCHIVE ??
        path.join(
          root,
          "artifacts",
          `skilled_${version}_${process.platform}-${process.arch}.tar.gz`,
        ),
      name = path.basename(archive),
      releases = path.join(dir, "files");
    await mkdir(path.join(releases, "v" + version), { recursive: true });
    await symlink(archive, path.join(releases, "v" + version, name));
    const checksum = await readFile(archive + ".sha256", "utf8");
    await writeFile(
      path.join(releases, "v" + version, name + ".sha256"),
      checksum,
    );
    await writeFile(path.join(releases, "latest-version.txt"), version + "\n");
    await writeFile(
      path.join(releases, "installer.sh"),
      await readFile(path.join(root, "install.sh")),
    );
    const requests: string[] = [];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      requests.push(url.pathname);
      const file = path.join(releases, decodeURIComponent(url.pathname));
      try {
        const info = await stat(file);
        if (!info.isFile()) throw new Error("not file");
        res.setHeader("Content-Length", info.size);
        createReadStream(file).pipe(res);
      } catch {
        res.writeHead(404);
        res.end("missing release file");
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    t.after(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        ),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`,
      bin = path.join(dir, "install directory/bin"),
      env = {
        SKILLED_VERSION: version,
        SKILLED_RELEASE_BASE_URL: base,
        SKILLED_REPOSITORY: "",
        INSTALL_DIR: bin,
      };
    let out = await run(["bash", path.join(root, "install.sh")], dir, env);
    assert.equal(out.code, 0, out.stdout + out.stderr);
    const launcher = path.join(bin, "skilled"),
      wrapper = await readFile(launcher, "utf8");
    assert.ok((await stat(launcher)).mode & 0o100);
    const outside = path.join(dir, "outside-checkout");
    await mkdir(outside);
    out = await run([launcher, "--version"], outside);
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.stdout, `skilled version ${version}\n`);
    out = await run([launcher, "init", "--print"], outside);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /kind: SkilledConfig/);
    out = await run([launcher, "run", "--help"], outside);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /--event-log/);
    out = await run(["bash", path.join(root, "install.sh")], dir, {
      ...env,
      SKILLED_VERSION: "latest",
    });
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.equal(await readFile(launcher, "utf8"), wrapper);
    assert.ok(requests.includes("/latest-version.txt"));
    await writeFile(
      path.join(releases, "v" + version, name + ".sha256"),
      "0".repeat(64) + "  " + name + "\n",
    );
    out = await run(["bash", path.join(root, "install.sh")], dir, env);
    assert.equal(out.code, 1);
    assert.match(out.stderr, /checksum mismatch/);
    assert.equal(await readFile(launcher, "utf8"), wrapper);
    assert.equal((await run([launcher, "--version"], outside)).code, 0);
    await writeFile(
      path.join(releases, "v" + version, name + ".sha256"),
      checksum,
    );
    out = await run(["bash", path.join(root, "install.sh")], dir, {
      ...env,
      SKILLED_VERSION: "9.9.9",
    });
    assert.notEqual(out.code, 0);
    assert.equal(await readFile(launcher, "utf8"), wrapper);
    // Repack the actual release with individually invalid metadata and CLI version.
    // These archives have valid sidecars: integrity alone must not switch the command.
    const extracted = path.join(dir, "repacked"),
      bundle = name.replace(/\.tar\.gz$/, "");
    await mkdir(extracted);
    out = await run(["tar", "-xzf", archive, "-C", extracted], dir);
    assert.equal(out.code, 0, out.stderr);
    const metadataPath = path.join(extracted, bundle, "installation.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const brandPath = path.join(extracted, bundle, "app/dist/src/brand.js");
    const brand = await readFile(brandPath, "utf8");
    const servedArchive = path.join(releases, "v" + version, name);
    await rm(servedArchive);
    for (const invalid of ["platform", "version"] as const) {
      await writeFile(
        metadataPath,
        JSON.stringify({
          ...metadata,
          target: invalid === "platform" ? "wrong-platform" : metadata.target,
        }),
      );
      await writeFile(
        brandPath,
        invalid === "version" ? brand.replaceAll(version, "9.9.9") : brand,
      );
      out = await run(
        ["tar", "-czf", servedArchive, "-C", extracted, bundle],
        dir,
      );
      assert.equal(out.code, 0, out.stderr);
      const digest = createHash("sha256")
        .update(await readFile(servedArchive))
        .digest("hex");
      await writeFile(servedArchive + ".sha256", digest + "  " + name + "\n");
      out = await run(["bash", path.join(root, "install.sh")], dir, env);
      assert.equal(out.code, 1, out.stdout + out.stderr);
      assert.match(
        out.stderr,
        invalid === "platform"
          ? /installation metadata does not match/
          : /CLI version mismatch/,
      );
      assert.equal(await readFile(launcher, "utf8"), wrapper);
      assert.equal(
        (await run([launcher, "--version"], outside)).stdout,
        `skilled version ${version}\n`,
      );
    }
    await rm(servedArchive);
    await symlink(archive, servedArchive);
    await writeFile(servedArchive + ".sha256", checksum);
    // The Action's fallback downloads a checksum-pinned installer and real release.
    const actionHome = path.join(dir, "action-home");
    await mkdir(path.join(actionHome, "evals/cases"), { recursive: true });
    await writeFile(
      path.join(actionHome, "SKILL.md"),
      "---\nname: installer-action\n---\n",
    );
    await writeFile(
      path.join(actionHome, "evals/eval.yaml"),
      JSON.stringify({
        schema_version: "v1alpha1",
        environment: { type: "none" },
        engine: {
          name: "custom",
          custom: {
            transport: "local",
            response_format: "text",
            local: { command: "printf", args: ["installed action succeeded"] },
          },
        },
        cases: { files: ["evals/cases/pass.yaml"] },
        judge: {
          type: "rule_based",
          success: [
            { output_contains: { all: ["installed action succeeded"] } },
          ],
        },
      }),
    );
    await writeFile(
      path.join(actionHome, "evals/cases/pass.yaml"),
      JSON.stringify({ id: "pass", input: { prompt: "actual process" } }),
    );
    const installerBytes = await readFile(path.join(root, "install.sh")),
      installerSHA = createHash("sha256").update(installerBytes).digest("hex");
    const actionEnv = {
      PATH:
        path.dirname(process.execPath) +
        path.delimiter +
        "/usr/bin:/bin:/usr/sbin:/sbin",
      GITHUB_WORKSPACE: actionHome,
      GITHUB_OUTPUT: path.join(actionHome, "github-output"),
      SKILLED_INSTALL_URL: base + "/installer.sh",
      SKILLED_INSTALL_SHA256: installerSHA,
      SKILLED_RELEASE_BASE_URL: base,
    };
    out = await run(
      [
        process.execPath,
        path.join(root, "dist/action/main.js"),
        "--skill-target",
        "evals/eval.yaml",
      ],
      actionHome,
      actionEnv,
    );
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /Installed skilled/);
    assert.match(
      await readFile(path.join(actionHome, "github-output"), "utf8"),
      /exit-code=0/,
    );
    const badHome = path.join(dir, "bad-installer");
    await mkdir(badHome);
    out = await run(
      [process.execPath, path.join(root, "dist/action/main.js")],
      badHome,
      {
        ...actionEnv,
        HOME: badHome,
        GITHUB_WORKSPACE: badHome,
        SKILLED_INSTALL_SHA256: "0".repeat(64),
      },
    );
    assert.equal(out.code, 1);
    assert.match(out.stderr, /installer checksum mismatch/);
    await assert.rejects(
      stat(path.join(badHome, ".skilled-tools/bin/skilled")),
    );
  },
);

test(
  "real Linux Docker installer downloads and executes the bundled CLI without a system Node dependency",
  {
    skip:
      process.env.SKILLED_ACTION_DOCKER_INTEGRATION !== "1"
        ? "enable SKILLED_ACTION_DOCKER_INTEGRATION=1 with the real image and Linux release"
        : false,
    timeout: 240000,
  },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "skilled-installer-linux-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const script = `set -euo pipefail
arch=$(node -p process.arch)
name="skilled_${releaseVersion}_linux-$arch.tar.gz"
mkdir -p /tmp/releases/v${releaseVersion} /tmp/outside
ln -s "/releases/$name" "/tmp/releases/v${releaseVersion}/$name"
ln -s "/releases/$name.sha256" "/tmp/releases/v${releaseVersion}/$name.sha256"
python3 -m http.server 18890 --bind 127.0.0.1 --directory /tmp/releases >/tmp/http.log 2>&1 &
server=$!
trap 'kill "$server"' EXIT
for attempt in $(seq 1 50); do if curl -fsS http://127.0.0.1:18890/ >/dev/null; then break; fi; sleep 0.1; done
PATH=/usr/bin:/bin INSTALL_DIR='/tmp/installed cli/bin' SKILLED_VERSION=${releaseVersion} SKILLED_RELEASE_BASE_URL=http://127.0.0.1:18890 bash /install.sh
cd /tmp/outside
PATH=/usr/bin:/bin '/tmp/installed cli/bin/skilled' --version
PATH=/usr/bin:/bin '/tmp/installed cli/bin/skilled' init --print
PATH=/usr/bin:/bin '/tmp/installed cli/bin/skilled' run --help
`;
    const out = await run(
      [
        "docker",
        "run",
        "--rm",
        "--network",
        "none",
        "--entrypoint",
        "bash",
        "-v",
        path.join(root, "artifacts") + ":/releases:ro",
        "-v",
        path.join(root, "install.sh") + ":/install.sh:ro",
        process.env.SKILLED_ACTION_IMAGE || "skilled-phase5-action:local",
        "-c",
        script,
      ],
      dir,
    );
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.ok(out.stdout.includes(`skilled version ${releaseVersion}`));
    assert.match(out.stdout, /kind: SkilledConfig/);
    assert.match(out.stdout, /--event-log/);
  },
);
