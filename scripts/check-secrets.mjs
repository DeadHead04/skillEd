import fs from "node:fs";
import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter(
    (file) =>
      /^(?:apps|packages|scripts)\//.test(file) &&
      !/\.(?:png|jpe?g|gif|webp|zip)$/i.test(file) &&
      !/(?:test|spec|testdata|e2e)/i.test(file),
  );

const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{24,}\b/,
];

const findings = [];
for (const file of tracked) {
  const content = fs.readFileSync(file, "utf8");
  for (const pattern of patterns) {
    if (pattern.test(content)) findings.push(`${file}: ${pattern}`);
  }
}

if (findings.length > 0) {
  console.error(`Potential secrets found:\n${findings.join("\n")}`);
  process.exit(1);
}

console.log(
  `Secret-pattern scan passed (${tracked.length} application files).`,
);
