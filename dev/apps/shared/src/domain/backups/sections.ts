import { backupEntryKey } from "./format";
import type { BackupLocation, VaultBackupEntry } from "./types";

/** The Saves or the Standard backups of one folder. */
export interface BackupTierGroup {
  /** Saves (pins) or Standard. */
  saved: boolean;
  entries: VaultBackupEntry[];
  /** `backupEntryKey` of each entry, in the same order. */
  keys: string[];
}

/** One collapsible section of the Backups window: every backup in one folder. */
export interface BackupListSection {
  /** The folder's place, stable across reloads. */
  id: BackupLocation;
  location: BackupLocation;
  /** Saves, then Standard; a tier with nothing in it is left out. */
  groups: BackupTierGroup[];
  /** Every key of the section, Saves first. */
  keys: string[];
  /** The folder these zips are in, when the list gave their paths. */
  folder: string | null;
}

/** How much of a section is selected, for its select-all box. */
export type BackupSectionSelection = "none" | "some" | "all";

function parentOf(path: string | undefined): string | null {
  if (!path) return null;
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : null;
}

/** The folder a backup is in, above `saves/` for a pin. */
function backupFolderOf(entry: VaultBackupEntry): string | null {
  const parent = parentOf(entry.path);
  return entry.saved ? parentOf(parent ?? undefined) : parent;
}

/**
 * The data folder, then the chosen folder, each with its Saves before its
 * Standard backups. Only a folder that holds a backup is listed.
 */
export function backupListSections(
  backups: readonly VaultBackupEntry[],
  vaultId: string,
): BackupListSection[] {
  const sections: BackupListSection[] = [];
  for (const location of ["data_folder", "chosen"] as const) {
    const inPlace = backups.filter(
      (entry) => (entry.location === "chosen" ? "chosen" : "data_folder") === location,
    );
    if (inPlace.length === 0) continue;
    const groups: BackupTierGroup[] = [];
    for (const saved of [true, false]) {
      const entries = inPlace.filter((entry) => Boolean(entry.saved) === saved);
      if (entries.length === 0) continue;
      groups.push({ saved, entries, keys: entries.map((entry) => backupEntryKey(entry, vaultId)) });
    }
    sections.push({
      id: location,
      location,
      groups,
      keys: groups.flatMap((group) => group.keys),
      folder: inPlace.map(backupFolderOf).find((folder) => folder !== null) ?? null,
    });
  }
  return sections;
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
