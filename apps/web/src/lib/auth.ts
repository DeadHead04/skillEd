export const SESSION_COOKIE = "skilled_session";

const encoder = new TextEncoder();

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function signature(expires: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`admin.${expires}`)),
  );
}

export async function createSessionToken(secret: string, ttlSeconds = 86_400) {
  const expires = String(Math.floor(Date.now() / 1000) + ttlSeconds);
  return `v1.${expires}.${await signature(expires, secret)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
) {
  if (!token || !secret) return false;
  const [version, expires, supplied] = token.split(".");
  if (
    version !== "v1" ||
    !expires ||
    !supplied ||
    Number(expires) <= Math.floor(Date.now() / 1000)
  )
    return false;
  const expected = await signature(expires, secret);
  if (expected.length !== supplied.length) return false;
  let different = 0;
  for (let index = 0; index < expected.length; index++)
    different |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return different === 0;
}
