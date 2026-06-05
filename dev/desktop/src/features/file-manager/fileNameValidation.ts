import { validateDisplayName } from "@/lib/vaultDisplayName";

export type FileNameValidationCode = ReturnType<typeof validateDisplayName>;

export function validateFileName(name: string): FileNameValidationCode | null {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  if (trimmed === "." || trimmed === "..") return "invalid_chars";
  return validateDisplayName(trimmed);
}
