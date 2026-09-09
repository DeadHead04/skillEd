import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
// A versioned format permits existing bcrypt accounts to keep working.
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return `scrypt-v1:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  const match = /^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(hash);
  if (!match) return false;
  const actual = (await derive(password, match[1]!, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(match[2]!, "hex"));
}
