import path from "node:path";

const MEDIA_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  "": "text/plain; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".go": "text/plain; charset=utf-8",
  ".rs": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
  ".css": "text/plain; charset=utf-8",
  ".html": "text/plain; charset=utf-8",
  ".htm": "text/plain; charset=utf-8",
  ".svg": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function mediaTypeFor(filePath: string): string {
  return (
    MEDIA_TYPES[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

export function isInlineImage(mediaType: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
    mediaType,
  );
}

export function isPreviewableText(mediaType: string): boolean {
  return (
    mediaType.startsWith("text/") || mediaType.startsWith("application/json")
  );
}
