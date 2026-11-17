import type { DeviceSystem } from "../device";
import {
  SHARED_BACKUPS_CONTAINER,
  UNLOCKED_CONTAINER,
  type FolderListKind,
  type FolderPathIssue,
} from "./types";

/**
 * Which paths a device group's rows may hold, and when two paths are the
 * same folder or one is inside another: core's `folder_list::path_rules`,
 * checked as text for the group's own system, so a Windows row is judged the
 * same way on a phone. Both test against `folder-path-cases.json`.
 */

/** Why `path` cannot be a row of a `list` list on a `system` device, or `null`. */
export function folderPathIssue(
  system: DeviceSystem,
  list: FolderListKind,
  path: string,
): FolderPathIssue | null {
  const trimmed = path.trim();
  if (!trimmed) return "empty";
  const parts = pathParts(system, trimmed);
  if (!parts) return "not_absolute";
  if (isUnderReservedUprivTree(trimmed)) return "reserved";
  const last = parts.segments.length - 1;
  const insideOther = parts.segments.some((segment, index) => {
    switch (list) {
      case "unlocked":
        // A row may itself be an `upriv-unlocked` folder, never a folder
        // inside one: a plain-text close wipes what is in there.
        return isBackupsContainer(segment) || (segment === UNLOCKED_CONTAINER && index !== last);
      case "backup":
        return segment === UNLOCKED_CONTAINER;
      case "data_folder":
        return segment === UNLOCKED_CONTAINER || isBackupsContainer(segment);
    }
  });
  return insideOther ? "overlap" : null;
}

/** True when `a` and `b` name the same folder on a `system` device. */
export function sameFolderPath(system: DeviceSystem, a: string, b: string): boolean {
  const left = pathParts(system, a.trim());
  const right = pathParts(system, b.trim());
  return (
    !!left &&
    !!right &&
    left.root === right.root &&
    left.segments.length === right.segments.length &&
    left.segments.every((segment, index) => segment === right.segments[index])
  );
}

/** A Windows path, a Unix path, or a storage-access tree: some system can hold it. */
export function isAbsoluteAddress(path: string): boolean {
  const trimmed = path.trim();
  return (
    isContentUri(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  );
}

/** A phone's storage-access tree (`content://…`). */
export function isContentUri(path: string): boolean {
  return path.trim().toLowerCase().startsWith("content://");
}

/** An absolute path of a computer, which core reads with the OS: not a phone's tree. */
export function isAbsoluteOsFilesystemPath(path: string): boolean {
  return !isContentUri(path) && isAbsoluteAddress(path);
}

/** Volumes of a phone's own storage: a tree there is named by its folder alone. */
const PHONE_STORAGE_VOLUMES = new Set(["primary", "home"]);

/**
 * A folder as a list shows it. A phone's storage-access tree reads as where
 * it is: its folder in the phone's own storage (`Documents/Upriv`), or on
 * another volume, such as a memory card, that volume's id first
 * (`1234-5678/Upriv`). Any other path shows as typed.
 */
export function folderShownName(path: string): string {
  const trimmed = path.trim();
  const id = contentTreeId(trimmed);
  if (id === null) return trimmed;
  const colon = id.indexOf(":");
  const volume = colon < 0 ? id : id.slice(0, colon);
  const folder = colon < 0 ? "" : id.slice(colon + 1).replace(/\/+$/, "");
  if (!folder) return volume;
  return PHONE_STORAGE_VOLUMES.has(volume) ? folder : `${volume}/${folder}`;
}

/** The decoded document id a tree address names (`primary:Documents/Upriv`), or `null`. */
function contentTreeId(uri: string): string | null {
  if (!isContentUri(uri)) return null;
  const marker = "/tree/";
  const start = uri.indexOf(marker);
  if (start < 0) return null;
  const raw = uri.slice(start + marker.length).split("/")[0] ?? "";
  return raw ? percentDecoded(raw) : null;
}

/** `upriv-backups`, or a vault's own `upriv-<folder id>-backups`. */
function isBackupsContainer(segment: string): boolean {
  if (segment === SHARED_BACKUPS_CONTAINER) return true;
  const match = /^upriv-(.+)-backups$/.exec(segment);
  return !!match && match[1].length > 0;
}

/** Whether `path` has a `.upriv` segment, a storage-access tree checked decoded. */
export function isUnderReservedUprivTree(path: string): boolean {
  const trimmed = path.trim();
  if (isContentUri(trimmed)) {
    return percentDecoded(trimmed)
      .split(/[/\\]/)
      .some((segment) => {
        const tail = segment.split(":").pop() ?? segment;
        return segment.toLowerCase() === ".upriv" || tail.toLowerCase() === ".upriv";
      });
  }
  return trimmed.split(/[/\\]/).some((segment) => segment.toLowerCase() === ".upriv");
}

/** An absolute path taken apart: its root and its folders, case folded where the system ignores case. */
interface PathParts {
  root: string;
  segments: string[];
}

function pathParts(system: DeviceSystem, path: string): PathParts | null {
  switch (system) {
    case "linux":
      return unixParts(path, false);
    case "macos":
    case "ios":
      return unixParts(path, true);
    case "windows":
      return windowsParts(path);
    case "android":
      return treeParts(path);
  }
}

function splitSegments(rest: string, separators: RegExp, fold: boolean): string[] {
  return rest
    .split(separators)
    .filter((segment) => segment.length > 0)
    .map((segment) => (fold ? segment.toLowerCase() : segment));
}

function unixParts(path: string, fold: boolean): PathParts | null {
  if (!path.startsWith("/")) return null;
  return { root: "/", segments: splitSegments(path.slice(1), /\//, fold) };
}

function windowsParts(path: string): PathParts | null {
  if (path.startsWith("\\\\") || path.startsWith("//")) {
    const segments = splitSegments(path.slice(2), /[\\/]/, true);
    if (segments.length < 2) return null;
    const share = segments.splice(0, 2);
    return { root: `\\\\${share.join("\\")}`, segments };
  }
  if (!/^[A-Za-z]:[\\/]/.test(path)) return null;
  return {
    root: path.slice(0, 2).toLowerCase(),
    segments: splitSegments(path.slice(3), /[\\/]/, true),
  };
}

/** `content://<authority>/tree/<volume>:<path>`, compared on its decoded volume and path. */
function treeParts(path: string): PathParts | null {
  if (!isContentUri(path)) return null;
  const decoded = percentDecoded(path);
  const rest = decoded.slice("content://".length);
  const treeAt = rest.indexOf("/tree/");
  if (treeAt < 0) return null;
  const authority = rest.slice(0, treeAt);
  const tree = rest.slice(treeAt + "/tree/".length);
  const colon = tree.indexOf(":");
  const volume = colon < 0 ? tree : tree.slice(0, colon);
  const inside = colon < 0 ? "" : tree.slice(colon + 1);
  if (!authority || !volume) return null;
  return { root: `${authority}/${volume}`, segments: splitSegments(inside, /\//, false) };
}

/** Percent escapes decoded, twice at most (a tree id escapes its document id once more). */
function percentDecoded(uri: string): string {
  let current = uri;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decodeOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

function decodeOnce(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    // A stray `%` that starts no escape stays as it is.
    return text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  }
}

/** `folder` joined with `name` the way `system` writes paths, for showing a folder Upriv makes. */
export function joinFolder(system: DeviceSystem, folder: string, name: string): string {
  const separator = system === "windows" ? "\\" : "/";
  return `${folder.trim().replace(/[\\/]+$/, "")}${separator}${name}`;
}
