export const TOOLCHAIN_CAPABILITIES = Object.freeze({
  schemaVersion: "skilled-toolchain-v1",
  languageModelRuntime: true,
  available: [
    "python3",
    "node",
    "openpyxl",
    "python-docx",
    "pypdf",
    "jsonschema",
  ],
  artifactFormats: ["text", "json", "csv", "xlsx"],
  packageInstallation: false,
  networkTools: false,
  liveMcp: false,
  limits: {
    cases: 50,
    trials: 3,
    uploadBytes: 200 * 1024 * 1024,
    artifactBytes: 250 * 1024 * 1024,
    logBytes: 10 * 1024 * 1024,
    parallelism: 1,
  },
});
export function unsupportedRequirements(dependencies: unknown): string[] {
  if (!Array.isArray(dependencies)) return [];
  const supported =
    /^(?:python(?:3)?|node(?:\.js)?|openpyxl(?:[= ]+3\.1\.5)?|python-docx(?:[= ]+1\.2\.0)?|pypdf(?:[= ]+6\.1\.1)?|jsonschema(?:[= ]+4\.25\.1)?|standard library|none)$/i;
  // Authoring commonly expresses the absence of a dependency as a sentence
  // rather than the canonical `none` token. Keep these forms narrowly anchored
  // so a sentence that goes on to require an unavailable tool is still blocked.
  const noRuntimeDependency =
    /^(?:no external tools or packages are required; plain[- ]text generation is sufficient|no external tools, packages, network access, mcp services, or files are required by the tested agent)\.?$/i;
  const builtInModelRuntime =
    /^(?:a )?language[- ]model runtime able to read user[- ]provided (?:plain[- ]text|clause text)\.?$/i;
  // Task understanding also records the material and orchestration context
  // used to author an evaluation. Those inputs are already supplied by
  // SkillEd and are not dependencies of the tested-agent runtime.
  const authoringContext =
    /^(?:(?:the )?target skill directory|(?:the )?(?:target )?skill instructions?|existing target evaluation configuration(?:,? if present)?|skill-up cli and credentials only if evaluations are run|uploaded (?:authority )?material)$/i;
  return dependencies
    .filter(
      (item) =>
        typeof item !== "string" ||
        (!supported.test(item.trim()) &&
          !noRuntimeDependency.test(item.trim()) &&
          !builtInModelRuntime.test(item.trim()) &&
          !authoringContext.test(item.trim())),
    )
    .map(String);
}
