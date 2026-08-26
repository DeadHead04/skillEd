export function safeFileHeaders(input: {
  relativePath: string;
  mediaType: string;
  inline: boolean;
}): Record<string, string> {
  const filename = input.relativePath.split("/").at(-1) ?? "file";
  return {
    "Content-Type": input.inline ? input.mediaType : "application/octet-stream",
    "Content-Disposition": `${input.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Content-Security-Policy":
      "default-src 'none'; img-src 'self'; style-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=31536000, immutable",
  };
}
