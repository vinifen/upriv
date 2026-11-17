import type { BackupSectionKind, VaultBackupEntry, VaultBackupListing } from "./types";
import type { DeviceRef } from "../device";
import type { FolderState } from "../folder-lists";

/** The Saves or the Standard backups of one folder. */
export interface BackupTierGroup {
  /** Saves (pins) or Standard. */
  saved: boolean;
  entries: VaultBackupEntry[];
  /** The key of each entry, in the same order. */
  keys: string[];
}

/** One collapsible section of the Backups window: every backup in one folder. */
export interface BackupListSection {
  /** The folder's reference, stable across reloads. */
  id: string;
  kind: BackupSectionKind;
  /** The folder, as this device reaches it. */
  folder: string;
  /** The device that wrote there; `null` for the data folder. */
  device: DeviceRef | null;
  status: FolderState;
  /** Saves, then Standard; a tier with nothing in it is left out. */
  groups: BackupTierGroup[];
  /** Every key of the section, Saves first. */
  keys: string[];
}

/** How much of a section is selected, for its select-all box. */
export type BackupSectionSelection = "none" | "some" | "all";

/**
 * The sections the window shows, in core's order: the data folder, the
 * folder in use, then the others. A folder shows while it holds a backup, or
 * while it cannot be reached, so it can be retried or forgotten.
 */
export function backupListSections(listing: VaultBackupListing): BackupListSection[] {
  return listing.sections
    .filter((section) => section.entries.length > 0 || section.status !== "ok")
    .map((section) => {
      const groups: BackupTierGroup[] = [];
      for (const saved of [true, false]) {
        const entries = section.entries.filter((entry) => entry.saved === saved);
        if (entries.length > 0) {
          groups.push({ saved, entries, keys: entries.map((entry) => entry.key) });
        }
      }
      return {
        id: section.folder,
        kind: section.kind,
        folder: section.path,
        device: section.device,
        status: section.status,
        groups,
        keys: groups.flatMap((group) => group.keys),
      };
    });
}

export function backupSectionSelection(
  keys: readonly string[],
  selected: ReadonlySet<string>,
): BackupSectionSelection {
  const count = keys.filter((key) => selected.has(key)).length;
  if (count === 0) return "none";
  return count === keys.length ? "all" : "some";
}

/**
 * The selection after a section's select-all: every key of the section on, or
 * every one off when they all were. Other sections keep theirs.
 */
export function toggleBackupSection(
  selected: ReadonlySet<string>,
  keys: readonly string[],
): Set<string> {
  const next = new Set(selected);
  const all = backupSectionSelection(keys, selected) === "all";
  for (const key of keys) {
    if (all) next.delete(key);
    else next.add(key);
  }
  return next;
}
