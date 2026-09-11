import { VAULT_DISPLAY_NAME_MAX_LENGTH } from "./constants";
import { isWindowsReservedName } from "../format/windowsReserved";

// eslint-disable-next-line no-control-regex -- vault names must reject ASCII control characters
const FORBIDDEN_CHARS = /[\\/:*?"<>|\x00-\x1f]/;
const TRAILING_INVALID = /[ .]$/;
export type DisplayNameValidationCode =
  "empty" | "invalid_chars" | "trailing" | "reserved" | "too_long";

/** Suggested vault name from an import `.zip` / `.7z` (basename only). */
export function displayNameFromImportFilename(filename: string): string {
  const leaf = filename.trim().split(/[\\/]/).pop() ?? "";
  return leaf.replace(/\.zip$/i, "").replace(/\.7z$/i, "");
}

const FORBIDDEN_CHARS_GLOBAL = new RegExp(FORBIDDEN_CHARS.source, "g");

/**
 * Best-effort valid display name. Illegal characters become `_`; reserved /
 * empty / trailing-dot names fall back to `"vault"`. Does not change the file.
 */
export function suggestValidDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (!validateDisplayName(trimmed)) return trimmed;
  let next = trimmed
    .replace(FORBIDDEN_CHARS_GLOBAL, "_")
    .replace(/[ .]+$/, "")
    .trim();
  if (next.length > VAULT_DISPLAY_NAME_MAX_LENGTH) {
    next = next
      .slice(0, VAULT_DISPLAY_NAME_MAX_LENGTH)
      .replace(/[ .]+$/, "")
      .trim();
  }
  if (!validateDisplayName(next)) return next;
  return "vault";
}

/** Seed the create-vault name field from an import filename. */
export function importDisplayNameFromFilename(filename: string): {
  displayName: string;
  needsChoice: boolean;
} {
  const fromFile = displayNameFromImportFilename(filename);
  const needsChoice = validateDisplayName(fromFile) !== null;
  return {
    displayName: needsChoice ? suggestValidDisplayName(fromFile) : fromFile,
    needsChoice,
  };
}

export function validateDisplayName(name: string): DisplayNameValidationCode | null {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  if (trimmed.length > VAULT_DISPLAY_NAME_MAX_LENGTH) return "too_long";
  if (FORBIDDEN_CHARS.test(trimmed)) return "invalid_chars";
  if (TRAILING_INVALID.test(trimmed)) return "trailing";
  if (isWindowsReservedName(trimmed)) return "reserved";
  return null;
}

/** First character of a word, uppercased (any code point — not letters-only). */
function firstCharUpper(word: string): string {
  for (const ch of word) {
    const upper = ch.toLocaleUpperCase();
    for (const out of upper) return out;
  }
  return "";
}

/**
 * List avatar from the vault name: first character of the first word,
 * plus the first character of the second word when there is one.
 * Always uppercase. One word → one character (“Notes” → “N”).
 */
export function vaultDisplayLetters(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "";
  const first = firstCharUpper(words[0] ?? "");
  if (words.length === 1) return first;
  return `${first}${firstCharUpper(words[1] ?? "")}`;
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
