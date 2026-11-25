import { isPhoneSystem, type DeviceSystem } from "../device";
import { joinFolder } from "./paths";
import { NOTHING_SELECTED, UNLOCKED_CONTAINER, type DeviceGroup, type Selection } from "./types";

/** Beside the data folder: the `upriv-unlocked` folder inside it, as `system` writes paths. */
export function besideFolder(system: DeviceSystem, dataFolder: string): string {
  return joinFolder(system, dataFolder, UNLOCKED_CONTAINER);
}

/**
 * Where the Data folder choice keeps backups, as `system` writes paths: the
 * vault's `.upriv/vaults/<id>/backups`, or `.upriv/vaults`, which holds every
 * vault's, for the app's list and a vault being created.
 */
export function dataFolderBackupsFolder(
  system: DeviceSystem,
  dataFolder: string,
  vaultId: string | null,
): string {
  const vaults = joinFolder(system, joinFolder(system, dataFolder, ".upriv"), "vaults");
  return vaultId ? joinFolder(system, joinFolder(system, vaults, vaultId), "backups") : vaults;
}

/**
 * The folder `selection` names in `group`: a row's path, or what `fixed`
 * gives for a fixed choice. `null` when nothing is selected, the row is
 * gone, or the fixed choice names no folder here.
 */
export function selectionFolder<F extends string>(
  selection: Selection<F>,
  group: DeviceGroup<F> | undefined,
  fixed: (choice: F) => string | null,
): string | null {
  if (selection === NOTHING_SELECTED) return null;
  if (typeof selection === "number") {
    const path = group?.rows.find((row) => row.number === selection)?.path.trim();
    return path || null;
  }
  return fixed(selection);
}

/**
 * The folders the app list's fixed choice names on this device, which no
 * row may repeat (core `app_fixed_folders`): the data folder, and Beside the
 * data folder in it. None while the data folder is not known.
 */
export function appUnlockedFixedFolders(system: DeviceSystem, dataFolder: string | null): string[] {
  return dataFolder ? [dataFolder, besideFolder(system, dataFolder)] : [];
}

/**
 * The folder Default names on this device, which no row of the data folder
 * list may repeat (core `fixed_folders`). None on a phone, whose Default is a
 * tree the platform mounts, not a path, or while it is not known.
 */
export function dataFolderFixedFolders(
  system: DeviceSystem,
  defaultFolder: string | null,
): string[] {
  return defaultFolder && !isPhoneSystem(system) ? [defaultFolder] : [];
}
