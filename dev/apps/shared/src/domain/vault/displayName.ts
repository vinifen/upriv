import { VAULT_DISPLAY_NAME_MAX_LENGTH } from "./constants";
import { normalizeStoredName } from "../format/storedName";
import { isWindowsReservedName } from "../format/windowsReserved";
import { slugIdIsValid } from "../vault-groups/slugId";

// eslint-disable-next-line no-control-regex -- vault names must reject ASCII control characters
const FORBIDDEN_CHARS = /[\\/:*?"<>|\x00-\x1f]/;
const TRAILING_INVALID = /[ .]$/;
export type DisplayNameValidationCode =
  "empty" | "invalid_chars" | "trailing" | "reserved" | "too_long";

/** Suggested vault name from an import `.zip` / `.7z` (basename only). */
export function displayNameFromImportFilename(filename: string): string {
  const leaf = filename.trim().split(/[\\/]/).pop() ?? "";
  return normalizeStoredName(leaf.replace(/\.zip$/i, "").replace(/\.7z$/i, ""));
}

const FORBIDDEN_CHARS_GLOBAL = new RegExp(FORBIDDEN_CHARS.source, "g");

/**
 * Best-effort valid display name. Illegal characters become `_`; reserved /
 * empty / trailing-dot names fall back to `"vault"`. Does not change the file.
 */
export function suggestValidDisplayName(raw: string): string {
  const trimmed = normalizeStoredName(raw);
  if (!validateDisplayName(trimmed)) return trimmed;
  let next = normalizeStoredName(
    trimmed.replace(FORBIDDEN_CHARS_GLOBAL, "_").replace(/[ .]+$/u, ""),
  );
  if (next.length > VAULT_DISPLAY_NAME_MAX_LENGTH) {
    next = normalizeStoredName(next.slice(0, VAULT_DISPLAY_NAME_MAX_LENGTH).replace(/[ .]+$/u, ""));
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

function displayNameKey(name: string): string {
  return normalizeStoredName(name).toLowerCase();
}

/**
 * Keep `base` when no vault already uses it (case-insensitive).
 * Otherwise `base 2`, `base 3`, … trimmed to the display-name limit.
 */
export function uniqueDisplayName(base: string, existing: readonly string[]): string {
  const used = new Set(existing.map((name) => displayNameKey(name)));
  const start = suggestValidDisplayName(normalizeStoredName(base) || "vault");
  const taken = (name: string) => used.has(displayNameKey(name));
  if (!taken(start)) return start;
  for (let n = 2; n < 10_000; n += 1) {
    const suffix = ` ${n}`;
    const room = VAULT_DISPLAY_NAME_MAX_LENGTH - suffix.length;
    let stem = start;
    if (stem.length > room) {
      stem = normalizeStoredName(stem.slice(0, Math.max(1, room)).replace(/[ .]+$/u, ""));
    }
    if (!stem) stem = "vault";
    const candidate = `${stem}${suffix}`;
    if (validateDisplayName(candidate) === null && !taken(candidate)) return candidate;
  }
  return start;
}

/** Name for the create-from-backup button: `{source} backup`, then `{source} backup 2`. */
export function backupVaultDisplayName(
  sourceDisplayName: string,
  existing: readonly string[],
): string {
  const source = suggestValidDisplayName(sourceDisplayName);
  const suffix = " backup";
  const room = VAULT_DISPLAY_NAME_MAX_LENGTH - suffix.length;
  let stem = source;
  if (stem.length > room) {
    stem = normalizeStoredName(stem.slice(0, Math.max(1, room)).replace(/[ .]+$/u, "")) || "vault";
  }
  return uniqueDisplayName(`${stem}${suffix}`, existing);
}

/** Filename suggestion, with ` N` when a vault already has that name. */
export function suggestedImportDisplayName(
  filename: string,
  existingDisplayNames: readonly string[] = [],
): string {
  return uniqueDisplayName(
    importDisplayNameFromFilename(filename).displayName,
    existingDisplayNames,
  );
}

export function validateDisplayName(name: string): DisplayNameValidationCode | null {
  const trimmed = normalizeStoredName(name);
  if (!trimmed) return "empty";
  if (trimmed.length > VAULT_DISPLAY_NAME_MAX_LENGTH) return "too_long";
  if (FORBIDDEN_CHARS.test(trimmed)) return "invalid_chars";
  if (TRAILING_INVALID.test(trimmed)) return "trailing";
  if (isWindowsReservedName(trimmed)) return "reserved";
  return null;
}

/** Inline field error while typing. `allowEmpty` for optional “new group” inputs.
 * Persist trims/collapses spaces — in-progress spaces are not errors. */
export function liveDisplayNameError(
  name: string,
  options?: { allowEmpty?: boolean },
): DisplayNameValidationCode | null {
  const code = validateDisplayName(name);
  if (!code) return null;
  if (options?.allowEmpty && code === "empty") return null;
  return code;
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
  const words = normalizeStoredName(displayName).split(" ").filter(Boolean);
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

  while (existingIds.includes(candidate) || !slugIdIsValid(candidate)) {
    const tail = `-${suffix}`;
    let stem = base.slice(0, Math.max(1, 64 - tail.length)).replace(/-+$/u, "");
    if (!stem) stem = "v";
    candidate = `${stem}${tail}`;
    suffix += 1;
  }

  return candidate;
}
