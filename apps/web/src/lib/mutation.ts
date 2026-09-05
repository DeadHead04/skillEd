import { db, sha256, type Db } from "@skilled/core";
const database = db();
class Rejected extends Error {
  constructor(readonly response: Response) {
    super("Mutation rejected");
  }
}
export async function mutation(
  request: Request,
  operation: (sql: Db) => Promise<Response>,
): Promise<Response> {
  const actor = request.headers.get("x-skilled-user-id") ?? "anonymous";
  const key = request.headers.get("idempotency-key");
  if (
    key &&
    request.headers.get("content-type")?.includes("multipart/form-data")
  )
    return Response.json(
      {
        code: "INVALID_KEY",
        detail:
          "Upload streams do not accept idempotency keys. Package identity is checked after upload.",
      },
      { status: 400 },
    );
  const contentType = request.headers.get("content-type") ?? "";
  const streamed = contentType.includes("multipart/form-data");
  let body = streamed ? "streamed-upload" : "";
  if (!streamed && request.body) {
    const reader = request.clone().body!.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_000_000) {
        void reader.cancel().catch(() => undefined);
        return Response.json(
          { code: "REQUEST_TOO_LARGE", detail: "Request exceeds 1 MiB" },
          { status: 413 },
        );
      }
      parts.push(chunk.value);
    }
    body = Buffer.concat(parts).toString("utf8");
  }
  if (body.length > 0 && !streamed && !contentType.includes("application/json"))
    return Response.json(
      {
        code: "INVALID_CONTENT_TYPE",
        detail: "Use application/json for lifecycle requests",
      },
      { status: 415 },
    );
  const fingerprint = sha256(
    `${request.method}:${new URL(request.url).pathname}:${body}`,
  );
  try {
    return (await database.begin(async (tx) => {
      // One installation and bounded metadata operations. Execution occurs after commit.
      await tx`SELECT pg_advisory_xact_lock(83746203)`;
      if (key) {
        if (key.length > 200)
          throw new Rejected(
            Response.json({ code: "INVALID_KEY" }, { status: 400 }),
          );
        const [receipt] =
          await tx`SELECT * FROM request_receipts WHERE actor_id=${actor} AND request_key=${key}`;
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            throw new Rejected(
              Response.json(
                {
                  code: "IDEMPOTENCY_CONFLICT",
                  detail: "Request key was used for different input",
                },
                { status: 409 },
              ),
            );
          return Response.json(receipt.response, { status: receipt.status });
        }
      }
      const response = await operation(tx as unknown as Db);
      if (!response.ok) throw new Rejected(response);
      if (key)
        await tx`INSERT INTO request_receipts(actor_id,request_key,fingerprint,response,status) VALUES(${actor},${key},${fingerprint},${tx.json(await response.clone().json())},${response.status})`;
      return response;
    })) as unknown as Response;
  } catch (error) {
    if (error instanceof Rejected) return error.response;
    return Response.json(
      {
        code: "STATE_CONFLICT",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 409 },
    );
  }
}
