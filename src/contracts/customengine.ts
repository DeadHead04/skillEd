// Modified for the skilled TypeScript distribution.
export type {
  CustomEngineConfig,
  LocalConfig,
  HTTPConfig,
  HTTPFile,
} from "./schema.js";
export const conversationModeBatch = "batch";
export const conversationModeStateful = "stateful";
export function cloneConfig<T>(cfg: T): T {
  return structuredClone(cfg);
}
export function workspaceRelPathSafe(path: string): boolean {
  return (
    path !== "" && !path.startsWith("/") && !path.split("/").includes("..")
  );
}
export interface TemplateToken {
  name: string;
  default: string;
  errMsg: string;
  hasDefault: boolean;
  hasErrForm: boolean;
}
export function parseTemplateToken(inner: string): TemplateToken {
  const result: TemplateToken = {
    name: inner,
    default: "",
    errMsg: "",
    hasDefault: false,
    hasErrForm: false,
  };
  let i = inner.indexOf(":-");
  if (i >= 0) {
    result.name = inner.slice(0, i);
    result.default = inner.slice(i + 2);
    result.hasDefault = true;
  } else if ((i = inner.indexOf("?")) >= 0) {
    result.name = inner.slice(0, i);
    result.errMsg = inner.slice(i + 1);
    result.hasErrForm = true;
  }
  return result;
}
export function requiredError(token: TemplateToken): Error {
  return new Error(
    token.errMsg.trim() ? token.errMsg : token.name + " is required",
  );
}
