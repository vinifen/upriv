import { isPhoneSystem, type DeviceSystem } from "../device";
import { joinFolder } from "./paths";
import { UNLOCKED_CONTAINER } from "./types";

/** Beside the data folder: the `upriv-unlocked` folder inside it, as `system` writes paths. */
export function besideFolder(system: DeviceSystem, dataFolder: string): string {
  return joinFolder(system, dataFolder, UNLOCKED_CONTAINER);
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
