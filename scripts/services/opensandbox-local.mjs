#!/usr/bin/env node
// Reproducible real local OpenSandbox service. Requires uv and a running Docker daemon.
// Usage: node scripts/services/opensandbox-local.mjs start [state-directory]
//        node scripts/services/opensandbox-local.mjs stop [state-directory]
// The environment.json file contains an ephemeral API key; never commit it.
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, open, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
const action = process.argv[2] || "start";
const directory = path.resolve(
  process.argv[3] || path.join(os.tmpdir(), "skilled-opensandbox-real"),
);
const record = path.join(directory, "service.json");
const execdImage =
  "opensandbox/execd:v1.0.16@sha256:af7b55c861926c1304371c4578007fbaa424538219154a6a49a5d636217d2a3a";
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0)
    throw new Error(
      command + " failed: " + (result.error?.message || result.status),
    );
}
async function ownedProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1)
    throw new Error("invalid saved service pid");
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  return (
    result.status === 0 &&
    result.stdout.includes(path.join(directory, "venv")) &&
    result.stdout.includes(path.join(directory, "sandbox.toml"))
  );
}
if (action === "stop") {
  const saved = JSON.parse(await readFile(record, "utf8"));
  if (await ownedProcess(saved.pid)) {
    process.kill(saved.pid, "SIGTERM");
    console.log("Stopped owned local OpenSandbox server.");
  } else console.log("Owned server is not running; no process was stopped.");
} else if (action === "start") {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const saved = JSON.parse(await readFile(record, "utf8"));
    if (await ownedProcess(saved.pid)) {
      console.log(
        "Owned service already running; environment: " +
          path.join(directory, "environment.json"),
      );
      process.exit(0);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  run("docker", ["version"]);
  run("docker", ["pull", execdImage]);
  run("docker", ["pull", "alpine:3.20"]);
  run("uv", ["venv", "--python", "3.12", path.join(directory, "venv")]);
  const python = path.join(
    directory,
    "venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  run("uv", [
    "pip",
    "install",
    "--python",
    python,
    "opensandbox-server==0.1.13",
  ]);
  const port = Number(process.env.SKILLED_OPENSANDBOX_PORT || 18080);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("invalid port");
  const apiKey = randomBytes(32).toString("hex");
  const config = path.join(directory, "sandbox.toml");
  // Docker Desktop bridge publishes execd ports on localhost. Server proxy resolves
  // internal Docker VM addresses, unreachable from a macOS host server, so use direct mode.
  await writeFile(
    config,
    `[server]\nhost = "127.0.0.1"\nport = ${port}\napi_key = "${apiKey}"\n\n[runtime]\ntype = "docker"\nexecd_image = "${execdImage}"\n\n[docker]\nnetwork_mode = "bridge"\nhost_ip = "127.0.0.1"\n`,
    { mode: 0o600 },
  );
  const environment = {
    OPENSANDBOX_API_KEY: apiKey,
    OPENSANDBOX_BASE_URL: `http://127.0.0.1:${port}`,
    SKILLED_REAL_OPENSANDBOX: "1",
    SKILLED_REAL_OPENSANDBOX_BASE_URL: `http://127.0.0.1:${port}`,
    SKILLED_REAL_OPENSANDBOX_IMAGE: "alpine:3.20",
    SKILLED_REAL_OPENSANDBOX_PROXY: "0",
  };
  await writeFile(
    path.join(directory, "environment.json"),
    JSON.stringify(environment, null, 2),
    { mode: 0o600 },
  );
  await chmod(config, 0o600);
  await chmod(path.join(directory, "environment.json"), 0o600);
  const log = await open(path.join(directory, "server.log"), "a", 0o600);
  const server = path.join(
    directory,
    "venv",
    process.platform === "win32"
      ? "Scripts/opensandbox-server.exe"
      : "bin/opensandbox-server",
  );
  const child = spawn(server, ["--config", config], {
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  await log.close();
  await writeFile(record, JSON.stringify({ pid: child.pid, port }, null, 2), {
    mode: 0o600,
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(environment.OPENSANDBOX_BASE_URL + "/health", {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready)
    throw new Error(
      "OpenSandbox did not become healthy; inspect " +
        path.join(directory, "server.log"),
    );
  console.log(
    "Real OpenSandbox ready. Read environment from " +
      path.join(directory, "environment.json") +
      " without printing its credentials.",
  );
} else throw new Error("Expected start or stop");
