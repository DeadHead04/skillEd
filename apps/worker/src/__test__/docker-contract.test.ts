import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

test("Docker sandbox profile retains every upstream restriction except its explicit namespace setup additions", async () => {
  const original = JSON.parse(
    await readFile("infra/docker/docker-default-v28.3.2.json", "utf8"),
  );
  const profile = JSON.parse(
    await readFile("infra/docker/codex-seccomp.json", "utf8"),
  );
  assert.equal(profile.defaultAction, "SCMP_ACT_ERRNO");
  assert.deepEqual(profile.archMap, original.archMap);
  assert.deepEqual(
    profile.syscalls.slice(0, original.syscalls.length),
    original.syscalls,
  );
  const additions = profile.syscalls.slice(original.syscalls.length);
  assert.deepEqual(
    additions.flatMap((rule: { names: string[] }) => rule.names),
    ["unshare", "clone", "mount", "umount2", "pivot_root"],
  );
  assert.equal(additions[0].args[0].valueTwo, 0);
  assert.equal(additions[1].args[0].valueTwo, 0x10000000);
});

test("local executor uses persistent in-container login and constrained runtime without a host credential bind", async () => {
  const compose = parse(await readFile("docker-compose.yml", "utf8"));
  const worker = compose.services.worker;
  assert.equal(worker.cpus, 2);
  assert.equal(worker.mem_limit, "4g");
  assert.equal(worker.pids_limit, 512);
  assert.deepEqual(worker.cap_drop, ["ALL"]);
  assert.ok(worker.security_opt.includes("no-new-privileges:true"));
  assert.equal(worker.privileged, undefined);
  assert.ok(worker.volumes.includes("codex-home:/home/skilled/.codex"));
  assert.ok(
    worker.volumes.every(
      (volume: unknown) => !JSON.stringify(volume).includes("auth.json"),
    ),
  );
  assert.ok(
    compose.services.web.ports.every((port: string) =>
      port.startsWith("127.0.0.1:"),
    ),
  );
});
