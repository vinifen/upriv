import { isAbsoluteOsFilesystemPath, isContentUri } from "../workspace";
import type { InfoField } from "./types";

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 0x20) return true;
  }
  return false;
}

/**
 * Absolute OS path or Android `content://` tree that the system file manager can open.
 * Display labels (`uri · .upriv/…`), dashes, and relative backup locators are not locations.
 */
export function revealableLocation(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "—" || trimmed.includes(" · ") || hasControlChar(trimmed)) {
    return undefined;
  }
  if (isContentUri(trimmed)) return trimmed;
  if (!isAbsoluteOsFilesystemPath(trimmed)) return undefined;
  return trimmed;
}

/** Copy `field` and set `openPath` when `source` is a location the file manager can open. */
export function withOpenPath(field: InfoField, source: string | null | undefined): InfoField {
  const openPath = revealableLocation(source);
  return openPath ? { ...field, openPath } : field;
}
