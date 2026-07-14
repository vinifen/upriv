export type VaultRootSource = "explicit" | "alias" | "nearby";

export type VaultRootResolveResult =
  | {
      status: "found";
      rootPath: string;
      source: VaultRootSource;
    }
  | {
      status: "needs_setup";
      /** Where `.upriv-root` would live (app home — see `app_home_dir` / `UPRIV_NEARBY_ANCHOR`). */
      aliasPath: string;
      /** Preferred folder for “create default structure here”. */
      nearbyAnchor: string;
    };

/** Contents of `.upriv-root` when the file exists (active or inactive). */
export type VaultRootAliasInfo = {
  path: string;
  active: boolean;
};

/** Nearby `.upriv/` beside the app (auto-detect target). */
export type NearbyVaultRootStatus = "absent" | "valid" | "incomplete" | "unreadable";

export type NearbyVaultRootStatusResult = {
  status: NearbyVaultRootStatus;
  nearbyAnchor: string;
};

/** Inspect `.upriv/` at an arbitrary absolute path (does not create/repair). */
export type VaultRootInspectResult = {
  status: NearbyVaultRootStatus;
  path: string;
};

/** How to replace an incomplete `.upriv/` when the UI confirms repair. */
export type IncompleteReplacePolicy = "delete" | "rename";

export const VAULT_ROOT_ALIAS_FILE = ".upriv-root";
