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
