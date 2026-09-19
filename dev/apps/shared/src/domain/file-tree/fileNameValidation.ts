import { isWindowsReservedName } from "../format/windowsReserved";

/** Windows path-component limit (UTF-16). Vault `display_name` stays 128. */
export const LOGICAL_FILE_NAME_MAX_LENGTH = 255;

// eslint-disable-next-line no-control-regex -- OS-forbidden on Windows; Linux/macOS also reject NUL/`/`.
const FORBIDDEN_CHARS = /[\\/:*?"<>|\x00-\x1f]/;
const FORBIDDEN_CHARS_GLOBAL = new RegExp(FORBIDDEN_CHARS.source, "g");

/** File/folder names never flag `trailing` — persist strips trailing space/dot. */
export type FileNameValidationResult = "empty" | "invalid_chars" | "reserved" | "too_long" | null;

/**
 * Keep the user’s spelling (internal spaces stay). Strip only trailing space/dot
 * — Windows cannot store those, other OSes should match.
 */
export function persistLogicalFileName(raw: string): string {
  return raw.replace(/[\s.]+$/u, "");
}

export function validateFileName(name: string): FileNameValidationResult {
  const persisted = persistLogicalFileName(name);
  if (!persisted) return "empty";
  if (persisted.length > LOGICAL_FILE_NAME_MAX_LENGTH) return "too_long";
  if (FORBIDDEN_CHARS.test(persisted)) return "invalid_chars";
  if (isWindowsReservedName(persisted)) return "reserved";
  return null;
}

/** Inline rename error. Trailing space/dot is stripped on persist, not flagged. */
export function liveFileNameError(name: string): FileNameValidationResult {
  return validateFileName(name);
}

/** Persist form, or `null` when the OS cannot store this as one path component. */
export function acceptedLogicalFileName(raw: string): string | null {
  const name = persistLogicalFileName(raw);
  if (!name || validateFileName(name)) return null;
  return name;
}

/**
 * Import / OS export: keep the original name unless a filesystem cannot store it.
 * Forbidden characters → `_`; trailing space/dot stripped; reserved stems get `_`.
 */
export function sanitizeLogicalFileName(raw: string, fallback = "file"): string {
  let next = persistLogicalFileName(raw.replace(FORBIDDEN_CHARS_GLOBAL, "_"));
  if (next.length > LOGICAL_FILE_NAME_MAX_LENGTH) {
    next = persistLogicalFileName(truncatePreservingExtension(next, LOGICAL_FILE_NAME_MAX_LENGTH));
  }
  if (!next || next === "." || next === "..") return fallback;
  if (isWindowsReservedName(next)) {
    next = persistLogicalFileName(markReservedStem(next));
  }
  if (validateFileName(next)) return fallback;
  return next;
}

function truncatePreservingExtension(name: string, max: number): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const ext = name.slice(dot);
    if (ext.length < max) {
      return `${name.slice(0, dot).slice(0, max - ext.length)}${ext}`;
    }
  }
  return name.slice(0, max);
}

function markReservedStem(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot > 0) return `${name.slice(0, dot)}_${name.slice(dot)}`;
  return `${name}_`;
}
