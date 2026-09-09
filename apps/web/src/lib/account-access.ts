import { createHash, randomBytes } from "node:crypto";
import {
  db,
  ensureSchema,
  LoginIdSchema,
  PasswordSchema,
  UserRoleSchema,
  problem,
} from "@skilled/core";
import { z } from "zod";
import { hashPassword, verifyPassword } from "./passwords";

export const accountDb = db();
let ready: Promise<void> | undefined;
export function accountSchemaReady() {
  ready ??= ensureSchema(accountDb).catch((error) => {
    ready = undefined;
    throw error;
  });
  return ready;
}
export const TokenSchema = z
  .string()
  .regex(
    /^[a-f0-9]{64}$/,
    "This link is invalid. Ask an administrator for a new link.",
  );
export const SignupSchema = z
  .object({
    token: TokenSchema,
    loginId: LoginIdSchema,
    displayName: z.string().trim().min(1).max(80),
    password: PasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export const ResetSchema = z
  .object({
    token: TokenSchema,
    password: PasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export const IssueSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("invitation"),
    label: z.string().trim().min(1).max(80),
    role: UserRoleSchema.default("operator"),
  }),
  z.object({ kind: z.literal("password_reset"), userId: z.uuid() }),
]);
export function digestToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function newAccountToken() {
  const token = randomBytes(32).toString("hex");
  return { token, hash: digestToken(token) };
}
export function accessError(code: string, detail: string, status = 400) {
  return Response.json(problem(code, "Account action unavailable", detail), {
    status,
    headers: { "cache-control": "no-store" },
  });
}
export function invalidLink() {
  return accessError(
    "LINK_UNAVAILABLE",
    "This link is invalid, expired, used, or revoked. Try signing in if you already completed it, or ask an administrator for a new link.",
    410,
  );
}
export async function matchesPassword(password: string, stored: string) {
  if (stored.startsWith("scrypt-v1:")) return verifyPassword(password, stored);
  // Legacy accounts remain valid without rewriting their history or credentials.
  if (!/^\$2[aby]\$/.test(stored)) return false;
  const [result] =
    await accountDb`SELECT crypt(${password},${stored})=${stored} AS matches`;
  return Boolean(result?.matches);
}
export { hashPassword };
