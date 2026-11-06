import type { I18nKey } from "../../i18n/catalog";

/** The file a held blob holds, as an index of this vault named it. */
export interface HeldFile {
  /** Where it was, as a file manager path. */
  path: string;
  size: number;
  /** Unix epoch milliseconds. */
  modifiedAt: number;
  /** When the file the tree holds at that path last changed; null when no file is there. */
  currentModifiedAt: number | null;
}

/**
 * Data the vault found with no file of its tree naming it, kept in its
 * `held/` folder until the person puts it back or deletes it
 * (`vault_fs_held`).
 */
export interface HeldItem {
  /** What put back and delete take. */
  name: string;
  /** Bytes it takes on disk. */
  size: number;
  /** When it was set aside, Unix epoch milliseconds. */
  heldAt: number;
  /** The file it holds; null for a piece no index names, which cannot be read. */
  file: HeldFile | null;
}

/** A held item that holds a file the person can put back. */
export type HeldFileItem = HeldItem & { file: HeldFile };

/** What the vault set aside: files to put back, and pieces that cannot be read. */
export interface HeldSummary {
  files: HeldFileItem[];
  pieces: HeldItem[];
  /** Bytes of every piece. */
  pieceBytes: number;
}

/** How a held file compares with the file at its path now, by when each last changed. */
export type HeldFileStanding = "absent" | "newer" | "older" | "same_time";

export const HELD_FILE_STANDING_I18N_KEYS = {
  absent: "modal.file_manager.held.standing_absent",
  newer: "modal.file_manager.held.standing_newer",
  older: "modal.file_manager.held.standing_older",
  same_time: "modal.file_manager.held.standing_same_time",
} as const satisfies Record<HeldFileStanding, I18nKey>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseHeldFile(raw: unknown): HeldFile | null {
  if (!isRecord(raw) || typeof raw.path !== "string" || !raw.path) return null;
  if (!isCount(raw.size) || !isCount(raw.modifiedAt)) return null;
  return {
    path: raw.path,
    size: raw.size,
    modifiedAt: raw.modifiedAt,
    currentModifiedAt: isCount(raw.currentModifiedAt) ? raw.currentModifiedAt : null,
  };
}

/** The `items` of a `vault_fs_held` answer. Entries it cannot read are left out. */
export function parseHeldItems(raw: unknown): HeldItem[] {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return [];
  const items: HeldItem[] = [];
  for (const item of raw.items) {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name) continue;
    if (!isCount(item.size) || !isCount(item.heldAt)) continue;
    items.push({
      name: item.name,
      size: item.size,
      heldAt: item.heldAt,
      file: parseHeldFile(item.file),
    });
  }
  return items;
}

function holdsFile(item: HeldItem): item is HeldFileItem {
  return item.file !== null;
}

/** The held items split for the file manager; null when nothing is held. */
export function heldSummary(items: readonly HeldItem[]): HeldSummary | null {
  if (items.length === 0) return null;
  const files = items.filter(holdsFile);
  const pieces = items.filter((item) => !holdsFile(item));
  const pieceBytes = pieces.reduce((sum, piece) => sum + piece.size, 0);
  return { files, pieces, pieceBytes };
}

export function heldFileStanding(file: HeldFile): HeldFileStanding {
  if (file.currentModifiedAt === null) return "absent";
  if (file.modifiedAt === file.currentModifiedAt) return "same_time";
  return file.modifiedAt > file.currentModifiedAt ? "newer" : "older";
}
