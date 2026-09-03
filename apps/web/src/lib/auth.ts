export const SESSION_COOKIE = "skilled_session";

export type SessionRole = "administrator" | "operator";
export type SessionClaims = {
  userId: string;
  role: SessionRole;
  sessionVersion: number;
  expiresAt: number;
};

const encoder = new TextEncoder();

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function unsigned(claims: SessionClaims) {
  return [
    "v2",
    claims.userId,
    claims.role,
    String(claims.sessionVersion),
    String(claims.expiresAt),
  ].join(".");
}

async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index++)
    different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}

export async function createSessionToken(
  user: {
    id: string;
    role: SessionRole;
    sessionVersion: number;
  },
  secret: string,
  ttlSeconds = 86_400,
) {
  const claims: SessionClaims = {
    userId: user.id,
    role: user.role,
    sessionVersion: user.sessionVersion,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const value = unsigned(claims);
  return `${value}.${await signature(value, secret)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
): Promise<SessionClaims | null> {
  if (!token || !secret) return null;
  const [version, userId, role, sessionVersion, expiresAt, supplied, extra] =
    token.split(".");
  if (
    version !== "v2" ||
    !userId ||
    (role !== "administrator" && role !== "operator") ||
    !sessionVersion ||
    !expiresAt ||
    !supplied ||
    extra ||
    !Number.isInteger(Number(sessionVersion)) ||
    Number(sessionVersion) < 1 ||
    !Number.isInteger(Number(expiresAt)) ||
    Number(expiresAt) <= Math.floor(Date.now() / 1000)
  )
    return null;
  const claims: SessionClaims = {
    userId,
    role,
    sessionVersion: Number(sessionVersion),
    expiresAt: Number(expiresAt),
  };
  const value = unsigned(claims);
  const expected = await signature(value, secret);
  return constantTimeEqual(expected, supplied) ? claims : null;
}

export function authenticatedUser(request: Request) {
  const id = request.headers.get("x-skilled-user-id");
  const loginId = request.headers.get("x-skilled-login-id");
  const encodedDisplayName = request.headers.get("x-skilled-display-name");
  const role = request.headers.get("x-skilled-user-role");
  if (
    !id ||
    !loginId ||
    !encodedDisplayName ||
    (role !== "administrator" && role !== "operator")
  )
    return null;
  let displayName: string;
  try {
    displayName = decodeURIComponent(encodedDisplayName);
  } catch {
    return null;
  }
  return { id, loginId, displayName, role: role as SessionRole };
}
