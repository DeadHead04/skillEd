import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist/bundled-plugins");
const copy = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    filter: (p) => !p.includes("__pycache__") && !p.endsWith(".pyc"),
  });
};
for (const host of ["codex", "dsh"]) {
  const name = `${host}-skilled`,
    src = join(root, "plugins", name),
    compiled = join(root, "dist/plugins", name),
    target = join(output, name);
  if (!existsSync(compiled))
    throw new Error(`Compile ${name} before packaging plugins`);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (entry.endsWith(".ts") || entry === "scripts" || entry === "lib")
      continue;
    copy(join(src, entry), join(target, entry));
  }
  for (const file of ["LICENSE", "NOTICE"])
    copy(join(root, file), join(target, file));
  if (host === "codex") {
    copy(join(compiled, "scripts"), join(target, "scripts"));
    writeFileSync(
      join(target, "package.json"),
      JSON.stringify({ name, private: true, type: "module" }, null, 2) + "\n",
    );
  } else {
    copy(join(compiled, "index.js"), join(target, "index.js"));
    copy(join(compiled, "lib"), join(target, "lib"));
  }
  copy(
    join(root, "skills/skilled-improve"),
    join(
      target,
      host === "codex" ? "skills/skilled-improve" : "dist/skilled-improve",
    ),
  );
  copy(
    join(root, "schemas/skill-observation"),
    join(
      target,
      host === "codex" ? "schemas/skill-observation" : "dist/skill-observation",
    ),
  );
  // Compiled DSH import also resolves its bundled assets during local integration.
  if (host === "dsh") {
    copy(
      join(root, "skills/skilled-improve"),
      join(compiled, "dist/skilled-improve"),
    );
  }
  console.log(`bundled ${name} -> ${target}`);
}
