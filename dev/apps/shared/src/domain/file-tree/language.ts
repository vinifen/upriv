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

/**
 * Opaque in the in-app editor (still stored). Classification only — import does
 * not skip these types.
 */
const BINARY_EXTENSIONS = [
  ".pdf",
  ".mp4",
  ".m4v",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".wmv",
  ".flv",
  ".mpeg",
  ".mpg",
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  ".aac",
  ".m4a",
  ".wma",
  ".opus",
  ".zip",
  ".7z",
  ".rar",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".tgz",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".wasm",
  ".exe",
  ".dll",
  ".so",
  ".dmg",
  ".iso",
  ".bin",
  ".dat",
  ".apk",
  ".ipa",
  ".jar",
] as const;

export function vaultFileLanguageFromPath(path: string, mimeHint?: string): VaultFileLanguage {
  const lower = path.toLowerCase();
  if (BINARY_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "binary";
  const mime = mimeHint?.trim().toLowerCase() ?? "";
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return "binary";
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "image";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".sh")) return "shell";
  if (lower.endsWith(".env") || lower.includes(".env.")) return "env";
  return "text";
}

/** True when the editor should not decode the file as text or an image. */
export function isImportableBinaryPath(path: string, mimeHint?: string): boolean {
  return vaultFileLanguageFromPath(path, mimeHint) === "binary";
}

/** Import is not typed-gated; reserved names are skipped elsewhere. */
export function isVaultImportUnsupported(_path: string, _mimeHint?: string): boolean {
  return false;
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
