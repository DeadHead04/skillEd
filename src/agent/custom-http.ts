// Modified for the skilled TypeScript distribution.
import type { CustomAgent, CustomRunPrep, TransportOutcome } from "./custom.js";
import type { Runtime, ExecOptions } from "./types.js";
import {
  renderTemplate,
  renderTemplateMap,
  combinedSignal,
  readLimitedResponse,
  maxHTTPResponseBytes,
} from "./custom-support.js";
import { buildMultipartBody } from "./custom-http-files.js";
export function structuredInjection(
  value: string,
  vars: Record<string, string>,
): unknown {
  if (["${session_input}", "${messages}", "${kwargs}"].includes(value))
    return JSON.parse(vars[value.slice(2, -1)]);
  return undefined;
}
export function renderBodyValue(
  value: unknown,
  vars: Record<string, string>,
): unknown {
  if (typeof value === "string") {
    const injected = structuredInjection(value, vars);
    return injected === undefined ? renderTemplate(value, vars) : injected;
  }
  if (Array.isArray(value))
    return value.map((v, i) => {
      try {
        return renderBodyValue(v, vars);
      } catch (e) {
        throw new Error(`request_body[${i}]: ${(e as Error).message}`, {
          cause: e,
        });
      }
    });
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        try {
          return [k, renderBodyValue(v, vars)];
        } catch (e) {
          throw new Error(
            `request_body[${JSON.stringify(k)}]: ${(e as Error).message}`,
            { cause: e },
          );
        }
      }),
    );
  return value;
}
export function buildRequestBody(prep: CustomRunPrep): string {
  const rb = prep.custom.http!.request_body;
  if (rb == null) return prep.sessJSON;
  return JSON.stringify(
    renderBodyValue(rb, { ...prep.vars, session_id: prep.sessionID }),
  );
}
export function errSecretInURL(): Error {
  return new Error(
    "engine.custom.http.url renders the API key into the URL, which would expose it in request logs and traces; reference ${api_key} from engine.custom.http.headers or request_body instead",
  );
}
export async function runHTTPTransport(
  a: CustomAgent,
  rt: Runtime,
  opts: ExecOptions,
  prep: CustomRunPrep,
): Promise<TransportOutcome> {
  const http = prep.custom.http;
  if (!http?.url)
    throw new Error(
      "engine.custom.http.url is required when transport is http",
    );
  let url: string;
  try {
    url = renderTemplate(http.url, prep.vars);
  } catch (e) {
    throw new Error(`render http.url: ${(e as Error).message}`, { cause: e });
  }
  if (a.containsAPIKey(url)) throw errSecretInURL();
  if (http.method && http.method.toUpperCase() !== "POST")
    throw new Error(
      `engine.custom.http.method must be POST (got ${JSON.stringify(http.method)})`,
    );
  const payload = buildRequestBody(prep);
  const body = http.files.length
    ? await buildMultipartBody(rt, http.files, payload, opts.signal)
    : payload;
  let headers: Headers;
  try {
    headers = new Headers(renderTemplateMap(http.headers, prep.vars));
  } catch (e) {
    throw new Error(`render http.headers: ${(e as Error).message}`, {
      cause: e,
    });
  }
  if (body instanceof FormData) headers.delete("content-type");
  else if (!headers.get("content-type"))
    headers.set("content-type", "application/json");
  let request: Request;
  try {
    request = new Request(url, {
      method: "POST",
      headers,
      body,
      signal: combinedSignal(opts.signal, prep.timeoutSec * 1000),
    });
  } catch (e) {
    throw new Error(`build http request: ${(e as Error).message}`, {
      cause: e,
    });
  }
  const empty = {
    raw: "",
    stdout: "",
    stderr: "",
    exitCode: 0,
    frameworkFiles: [],
  };
  let response: Response;
  try {
    response = await fetch(request);
  } catch (e) {
    const message = a.maskAPIKey((e as Error).message);
    return {
      ...empty,
      exitCode: 1,
      stderr: message,
      execErr: new Error(`custom engine http request failed: ${message}`),
    };
  }
  let bytes: Buffer;
  try {
    bytes = await readLimitedResponse(response, maxHTTPResponseBytes);
  } catch (e) {
    const message = a.maskAPIKey((e as Error).message);
    const full =
      message === `response exceeded ${maxHTTPResponseBytes} bytes`
        ? `custom engine http response exceeded ${maxHTTPResponseBytes} bytes`
        : `read custom engine http response: ${message}`;
    return { ...empty, exitCode: 1, stderr: message, execErr: new Error(full) };
  }
  const raw = bytes.toString();
  return {
    ...empty,
    raw,
    stdout: raw,
    ...(response.status < 200 || response.status >= 300
      ? {
          exitCode: response.status,
          stderr: a.maskAPIKey(raw.trim()),
          execErr: new Error(`custom engine http status ${response.status}`),
        }
      : {}),
  };
}
