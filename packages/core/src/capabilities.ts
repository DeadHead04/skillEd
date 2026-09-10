export const TOOLCHAIN_CAPABILITIES = Object.freeze({
  schemaVersion: "skilled-toolchain-v1",
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
  return dependencies
    .filter((item) => typeof item !== "string" || !supported.test(item.trim()))
    .map(String);
}
