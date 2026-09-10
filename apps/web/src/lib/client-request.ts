/** Keep the same key after an uncertain network failure; safe retries cannot enqueue twice. */
const pending = new Map<string, string>();
export async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const method = options.method ?? "GET";
  const json = typeof options.body === "string" || options.body === undefined;
  const identity = `${method}:${url}:${json ? (options.body ?? "") : ""}`;
  const headers = new Headers(options.headers);
  if (method !== "GET" && json) {
    if (!pending.has(identity)) pending.set(identity, crypto.randomUUID());
    headers.set("idempotency-key", pending.get(identity)!);
  }
  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(120_000),
    });
    // Proxy HTML or malformed responses are recoverable network errors.
    await response.clone().json();
    if (response.ok || response.status < 500) pending.delete(identity);
    return response;
  } catch {
    return Response.json(
      {
        code: "NETWORK_UNAVAILABLE",
        detail:
          "Connection lost. Your work is saved on the server. Retry this action or refresh to recover its status.",
      },
      { status: 503 },
    );
  }
}
export function safeRedirect(next: string | null, origin: string) {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\"))
    return "/skill";
  const target = new URL(next, origin);
  return target.origin === origin
    ? `${target.pathname}${target.search}${target.hash}`
    : "/skill";
}
