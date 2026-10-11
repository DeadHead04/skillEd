import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const directory = resolve(process.argv[2] || "evidence/collector");
const name = "skilled-phase1-otel";
if (process.argv.includes("--stop")) {
  const label = execFileSync(
    "docker",
    ["inspect", name, "--format", '{{index .Config.Labels "skilled.phase"}}'],
    { encoding: "utf8" },
  ).trim();
  if (label !== "1")
    throw new Error(
      "Refusing to remove a container without the expected ownership label",
    );
  execFileSync("docker", ["rm", "-f", name], { stdio: "inherit" });
} else {
  mkdirSync(join(directory, "output"), { recursive: true });
  const config = join(directory, "collector.yaml");
  writeFileSync(
    config,
    `receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
exporters:
  file:
    path: /output/telemetry.jsonl
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [file]
    metrics:
      receivers: [otlp]
      exporters: [file]
`,
  );
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      name,
      "--label",
      "skilled.phase=1",
      "--memory",
      "256m",
      "--cpus",
      "1",
      "-p",
      "127.0.0.1:14317:4317",
      "-p",
      "127.0.0.1:14318:4318",
      "-v",
      `${config}:/etc/otelcol-contrib/config.yaml:ro`,
      "-v",
      `${join(directory, "output")}:/output`,
      "otel/opentelemetry-collector-contrib@sha256:789689988e379c58ac12b07718dbcf4b23c2214bd804173c1c77af346d381c15",
    ],
    { stdio: "inherit" },
  );
  console.log(
    `Set SKILLED_TEST_OTEL_FILE=${join(directory, "output", "telemetry.jsonl")}`,
  );
}
