import { validateDisplayName, type DisplayNameValidationCode } from "../vault/displayName";

export type FileNameValidationResult =
  | DisplayNameValidationCode
  | "empty"
  | "invalid_chars"
  | null;

export function validateFileName(name: string): FileNameValidationResult {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  if (trimmed === "." || trimmed === "..") return "invalid_chars";
  return validateDisplayName(trimmed);
}
