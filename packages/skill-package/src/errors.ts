export class ImportSafetyError extends Error {
  constructor(
    public readonly code: "IMPORT_LIMIT_EXCEEDED" | "UNSAFE_ARCHIVE",
    message: string,
  ) {
    super(message);
    this.name = "ImportSafetyError";
  }
}
