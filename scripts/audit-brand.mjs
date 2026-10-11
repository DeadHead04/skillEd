import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2] ?? ".";
const excluded = new Set([".git", "node_modules", "artifacts", "evidence"]);
const legacy = /(?:skill|scale)[-_ ]?up(?:per|er)?/gi;
const failures = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    legacy.lastIndex = 0;
    if (legacy.test(entry.name)) failures.push(`${path}: legacy filename`);
    if (entry.isDirectory()) await scan(path);
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      if (bytes.includes(0)) continue;
      let contents;
      try {
        contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        continue;
      }
      legacy.lastIndex = 0;
      if (legacy.test(contents)) failures.push(`${path}: legacy product text`);
    }
  }
}
await scan(root);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "PASS: no legacy product names in application source, paths or compiled output.",
  );
