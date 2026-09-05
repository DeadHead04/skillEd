import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { z } from "zod";
const GrantSchema = z.object({
  key: z.string().min(1),
  operation: z.enum(["read", "write"]),
  expiresAt: z.number().int(),
  maxBytes: z.number().int().positive(),
  nonce: z.string(),
});
export type ArtifactGrant = z.infer<typeof GrantSchema>;
export function signArtifactGrant(
  grant: Omit<ArtifactGrant, "nonce" | "expiresAt">,
  privateKey = process.env.ARTIFACT_SIGNING_KEY ?? "",
) {
  const payload = Buffer.from(
    JSON.stringify({
      ...grant,
      nonce: crypto.randomUUID(),
      expiresAt: Date.now() + 5 * 60_000,
    }),
  ).toString("base64url");
  return `${payload}.${sign(null, Buffer.from(payload), createPrivateKey(privateKey)).toString("base64url")}`;
}
export function verifyArtifactGrant(
  token: string,
  key: string,
  operation: "read" | "write",
  publicKey = process.env.ARTIFACT_VERIFY_KEY ?? "",
) {
  const [payload, signature, extra] = token.split(".");
  if (
    !payload ||
    !signature ||
    extra ||
    !verify(
      null,
      Buffer.from(payload),
      createPublicKey(publicKey),
      Buffer.from(signature, "base64url"),
    )
  )
    throw new Error("Invalid artifact grant");
  const grant = GrantSchema.parse(
    JSON.parse(Buffer.from(payload, "base64url").toString()),
  );
  if (
    grant.key !== key ||
    grant.operation !== operation ||
    grant.expiresAt <= Date.now() ||
    grant.expiresAt > Date.now() + 6 * 60_000
  )
    throw new Error("Expired or unauthorized artifact grant");
  return grant;
}
