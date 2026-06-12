import { VAULT_DISPLAY_NAME_MAX_LENGTH } from "./constants";

// eslint-disable-next-line no-control-regex -- vault names must reject ASCII control characters
const FORBIDDEN_CHARS = /[\\/:*?"<>|\x00-\x1f]/;
const TRAILING_INVALID = /[ .]$/;
const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export type DisplayNameValidationCode =
  | "empty"
  | "invalid_chars"
  | "trailing"
  | "reserved"
  | "too_long";

export function displayNameFromArchiveFilename(filename: string): string {
  const base = filename.trim().replace(/\.7z$/i, "");
  return base || "";
}

export function validateDisplayName(name: string): DisplayNameValidationCode | null {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  if (trimmed.length > VAULT_DISPLAY_NAME_MAX_LENGTH) return "too_long";
  if (FORBIDDEN_CHARS.test(trimmed)) return "invalid_chars";
  if (TRAILING_INVALID.test(trimmed)) return "trailing";
  const stem =
    trimmed
      .replace(/[ .]+$/, "")
      .split(/[\\/]/)
      .pop() ?? trimmed;
  if (WINDOWS_RESERVED.has(stem.toLowerCase())) return "reserved";
  return null;
}

export function displayNameToVaultId(displayName: string, existingIds: readonly string[]): string {
  const normalized = displayName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const base = (normalized || "vault").slice(0, 64);
  let candidate = base;
  let suffix = 2;

  while (existingIds.includes(candidate)) {
    const tail = `-${suffix}`;
    candidate = `${base.slice(0, Math.max(1, 64 - tail.length))}${tail}`;
    suffix += 1;
  }

  return candidate;
}
