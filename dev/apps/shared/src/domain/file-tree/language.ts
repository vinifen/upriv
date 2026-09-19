import type { VaultFileLanguage } from "./types";

const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
  ".avif",
] as const;

export function vaultFileLanguageFromPath(path: string): VaultFileLanguage {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "binary";
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "image";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".sh")) return "shell";
  if (lower.endsWith(".env") || lower.includes(".env.")) return "env";
  return "text";
}

/** PDF and other non-text, non-image types the mock/live FM cannot store yet. */
export function isVaultImportUnsupported(path: string): boolean {
  return vaultFileLanguageFromPath(path) === "binary";
}

/** MIME for an image path (used when materializing a data URL). */
export function imageMimeFromPath(path: string, mimeHint?: string): string {
  const hint = mimeHint?.trim().toLowerCase();
  if (hint?.startsWith("image/")) return hint;
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
}

export function imageDataUrlFromBase64(base64: string, path: string, mimeHint?: string): string {
  return `data:${imageMimeFromPath(path, mimeHint)};base64,${base64}`;
}
