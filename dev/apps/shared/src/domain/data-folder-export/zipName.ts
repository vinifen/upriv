import type { I18nKey } from "../../i18n/catalog";

/**
 * Longest zip name, in bytes of UTF-8. Same limit as core
 * `DATA_FOLDER_ZIP_NAME_MAX_BYTES`, so `<name>.zip.upriv-part` fits every system.
 */
export const DATA_FOLDER_ZIP_NAME_MAX_BYTES = 200;

/** Windows treats these as devices whatever follows the first dot. Same list as core. */
const DEVICE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);

/** Refused by some system the copy may unzip on, as in core. */
const REFUSED_CHARACTERS = '<>:"/\\|?*';

/** Why a zip name cannot be sent. Empty only turns Export off. */
export type DataFolderZipNameIssue = "empty" | "invalid" | "too_long";

const ISSUE_I18N_KEYS = {
  invalid: "error.data_folder_export_name_invalid",
  too_long: "error.data_folder_export_name_too_long",
} as const satisfies Record<Exclude<DataFolderZipNameIssue, "empty">, I18nKey>;

/** `upriv-YYYY-MM-DD-HHmmss` in UTC: what the name field starts with. */
export function dataFolderZipDefaultName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `upriv-${date}-${time}`;
}

/** The typed name as core takes it: trimmed, and without a `.zip` the person added. */
export function dataFolderZipNameFromInput(input: string): string {
  const trimmed = input.trim();
  return trimmed.toLowerCase().endsWith(".zip") ? trimmed.slice(0, -4).trimEnd() : trimmed;
}

/**
 * Same rules as core `validate_data_folder_zip_name`, checked against the
 * shared `zip-name-cases.json`. Core still refuses what slips past.
 */
export function dataFolderZipNameIssue(name: string): DataFolderZipNameIssue | null {
  if (name === "") return "empty";
  if (utf8Length(name) > DATA_FOLDER_ZIP_NAME_MAX_BYTES) return "too_long";
  const refused =
    name.trim() !== name ||
    name.startsWith(".") ||
    name.endsWith(".") ||
    hasRefusedCharacter(name) ||
    DEVICE_NAMES.has(asciiUpper(name.split(".")[0] ?? ""));
  return refused ? "invalid" : null;
}

/** Message under the name field. Empty has none: Export is simply off. */
export function dataFolderZipNameIssueI18nKey(issue: DataFolderZipNameIssue): I18nKey | null {
  return issue === "empty" ? null : ISSUE_I18N_KEYS[issue];
}

function hasRefusedCharacter(name: string): boolean {
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    // A lone surrogate is not text core can receive.
    const loneSurrogate = code >= 0xd800 && code <= 0xdfff;
    if (control || loneSurrogate || REFUSED_CHARACTERS.includes(char)) return true;
  }
  return false;
}

function asciiUpper(value: string): string {
  return value.replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
