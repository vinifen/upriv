import type {
  ChoiceName,
  DataFolderChoice,
  DeviceGroups,
  FolderState,
  FolderSwitch,
} from "../folder-lists";

/** How resolve found the data folder this launch (wire `source`). */
export type VaultRootResolveSource =
  /** `UPRIV_VAULT_ROOT`: it wins over the list, and nothing is written for it. */
  | "explicit"
  /** Default: beside the app, the per-user app folder, or Documents/Upriv on a phone. */
  | "default"
  /** A row of this device's data folder list. */
  | "row";

export type VaultRootRelocateNotice = "left_behind" | "move_failed";

export type VaultRootPrivateRoot = "none" | "moved" | "left_behind";

/** How the desktop app was distributed (packaging). */
export type AppDistribution = "portable" | "installed" | "dev";

interface RelocateFields {
  /** Set when a Windows install directory still holds `.upriv`, or the move failed. */
  relocateNotice?: VaultRootRelocateNotice;
  relocatePath?: string;
}

export type VaultRootResolveResult =
  | ({ status: "found"; rootPath: string; source: VaultRootResolveSource } & RelocateFields)
  | ({
      /**
       * The first run: Default is selected, holds no data folder, and this
       * device has no row to try. Continue makes one there.
       */
      status: "needs_setup";
      /** Default's folder on a computer (app home); the phone's logical data folder. */
      defaultRootAnchor: string;
      distribution: AppDistribution;
      /** The vaults that ended with the data folder in use, when it was lost. */
      ended: string[];
    } & RelocateFields)
  | ({
      /**
       * The selected choice did not answer as a data folder, at launch or
       * once the one in use was lost: a search looks for one that does.
       */
      status: "selected_failed";
      choice: ChoiceName;
      reason: FolderState;
      /** The vaults that ended with the data folder in use, when it was lost. */
      ended: string[];
    } & RelocateFields);

/** `data_folder_list`: every device's group, and where Default is. */
export interface DataFolderListView {
  groups: DeviceGroups<DataFolderChoice>;
  /** Default's folder on a computer. `null` on a phone, where Default is Documents/Upriv. */
  defaultFolder: string | null;
  /** The data folder the environment sets (`UPRIV_VAULT_ROOT`): it wins over the list. */
  explicit: string | null;
}

/** What `data_folder_apply` did. */
export interface DataFolderApplied {
  rootPath: string;
  source: VaultRootResolveSource;
  /** False when only the list changed and the data folder in use stayed. */
  switched: boolean;
  /** A phone's copy of its private data folder, when it asked for one. */
  privateRoot?: VaultRootPrivateRoot;
  /** The vaults that ended with the lost data folder it replaced. */
  ended: string[];
}

/** What `data_folder_search` found. */
export interface DataFolderSearchResult {
  /** A data folder answers: the selection, kept or switched to it. */
  found: boolean;
  /** The switch, when the selection changed. */
  switch: FolderSwitch | null;
  /** The vaults that ended with the lost data folder. */
  ended: string[];
}

/**
 * How to repair an incomplete `.upriv/` when the UI confirms.
 * `reset_settings` writes a fresh `settings.toml` and keeps vaults, backups,
 * and groups (the usual damage from a pulled drive). `rename` moves the old
 * folder aside; `delete` removes it.
 */
export type IncompleteReplacePolicy = "reset_settings" | "rename" | "delete";

/**
 * Bootstrap UI prefs applied **only when creating** a new `.upriv/`. Opening
 * an already-valid data folder ignores this bag — see AGENT.md § "Selecting
 * an existing `.upriv`". Today the only pre-root pref is the UI locale.
 * Nested under `bootstrap` on the wire.
 */
export type VaultRootBootstrapPrefs = {
  locale: string;
};

/** The data folder list in the app home. */
export const DATA_FOLDER_LIST_FILE = ".upriv-data-folder";
