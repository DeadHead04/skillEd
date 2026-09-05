export function serviceEndpoint(name: "ARTIFACT" | "EXECUTOR") {
  const explicit = process.env[`${name}_SERVICE_URL`];
  const internal = process.env[`${name}_SERVICE_HOSTPORT`];
  if (!explicit && !internal) return undefined;
  const url = new URL(explicit ?? `http://${internal}`);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid internal service address");
  return url.origin;
}
