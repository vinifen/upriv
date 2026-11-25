import {
  APP_UNLOCKED_LIST,
  VAULT_UNLOCKED_LIST,
  addRow,
  appUnlockedFixedFolders,
  listChanges,
  rowProblems,
  selectHere,
  type AppUnlockedChoice,
  type DeviceGroups,
  type HereDevice,
  type ListChanges,
  type RowProblem,
  type VaultUnlockedChoice,
} from "../folder-lists";

/** "Where should the files go?": what the person chose before the password. */
export type PlainPlaceChoice =
  /** Beside the data folder, selected in the app's list on this device. */
  | "beside"
  /** A folder added to the app's list and selected: every vault that follows the app's goes there. */
  | "app_folder"
  /** A folder added to this vault's own list and selected. */
  | "vault_folder";

/** The list change the choice saves: one of the two lists. */
export type PlainPlaceChanges =
  | { list: "app"; changes: ListChanges<AppUnlockedChoice> }
  | { list: "vault"; changes: ListChanges<VaultUnlockedChoice> };

/**
 * The change "Where should the files go?" saves. `path` is the folder picked
 * or typed for the two folder choices.
 */
export function plainPlaceChanges(input: {
  choice: PlainPlaceChoice;
  path: string;
  here: HereDevice;
  appUnlocked: DeviceGroups<AppUnlockedChoice>;
  vaultUnlocked: DeviceGroups<VaultUnlockedChoice>;
}): PlainPlaceChanges {
  const { choice, here, appUnlocked, vaultUnlocked } = input;
  const path = input.path.trim();
  switch (choice) {
    case "beside": {
      const after = selectHere(appUnlocked, here, APP_UNLOCKED_LIST, "beside");
      return { list: "app", changes: listChanges(appUnlocked, after, APP_UNLOCKED_LIST) };
    }
    case "app_folder": {
      const after = addRow(appUnlocked, here, APP_UNLOCKED_LIST, path).groups;
      return { list: "app", changes: listChanges(appUnlocked, after, APP_UNLOCKED_LIST) };
    }
    case "vault_folder": {
      const after = addRow(vaultUnlocked, here, VAULT_UNLOCKED_LIST, path).groups;
      return {
        list: "vault",
        changes: listChanges(vaultUnlocked, after, VAULT_UNLOCKED_LIST),
      };
    }
  }
}

/**
 * What is wrong with `path` as the row a folder choice of "Where should the
 * files go?" adds, by the rules core applies to that row: the path itself,
 * a folder already in that list, and for the app's list the data folder or
 * Beside the data folder (`dataFolder`, `null` while not known). `empty`
 * while nothing is typed or picked; `null` when the row can be saved.
 */
export function plainPlaceProblem(input: {
  choice: Exclude<PlainPlaceChoice, "beside">;
  path: string;
  here: HereDevice;
  appUnlocked: DeviceGroups<AppUnlockedChoice>;
  vaultUnlocked: DeviceGroups<VaultUnlockedChoice>;
  dataFolder: string | null;
}): RowProblem | null {
  const { choice, here } = input;
  const path = input.path.trim();
  if (choice === "app_folder") {
    const added = addRow(input.appUnlocked, here, APP_UNLOCKED_LIST, path);
    const fixed = appUnlockedFixedFolders(here.system, input.dataFolder);
    const problems = rowProblems(
      input.appUnlocked[here.id],
      added.groups[here.id],
      APP_UNLOCKED_LIST,
      fixed,
    );
    return problems.get(added.number) ?? null;
  }
  const added = addRow(input.vaultUnlocked, here, VAULT_UNLOCKED_LIST, path);
  const problems = rowProblems(
    input.vaultUnlocked[here.id],
    added.groups[here.id],
    VAULT_UNLOCKED_LIST,
  );
  return problems.get(added.number) ?? null;
}
