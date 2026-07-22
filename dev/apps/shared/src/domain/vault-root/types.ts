import type { VaultRootMode } from "../app-settings";

/**
 * How resolve found the vault-root this launch (wire `source`).
 * Distinct from `VaultRootMode` (`vault_root_mode` preference) — never pass a mode
 * where a source is expected (or vice versa), even when both are `"custom_root"`.
 */
export type VaultRootResolveSource = "explicit" | "custom_root" | "default_root";

/** How the desktop app was distributed (packaging). */
export type AppDistribution = "portable" | "installed" | "dev";

/**
 * Snapshot for Gate-owned setup / recovery UI: one place for mode, disk alias, and
 * `default_root` anchor so modals do not each re-derive labels from partial state.
 *
 * Naming stays `defaultRoot*` (not `appHome`) to match wire/`default_root` mode.
 */
export type VaultRootPresentationState = {
  mode: VaultRootMode;
  /** Folder for creating `.upriv/` — app home; parent of `aliasPath`. */
  defaultRootAnchor: string;
  /** Absolute path of the `.upriv-root` file. */
  aliasPath: string;
  /**
   * Path remembered inside `.upriv-root` (active or inactive).
   * May be set while `mode === "default_root"` (inactive alias).
   */
  rememberedAliasTarget: string | null;
};

export type VaultRootResolveResult =
  | {
      status: "found";
      rootPath: string;
      source: VaultRootResolveSource;
    }
  | {
      status: "needs_setup";
      /**
       * Absolute path of `.upriv-root`. Invariant: parent directory equals
       * `defaultRootAnchor` (both are app home).
       */
      aliasPath: string;
      /** `default_root` create target (app home for all distributions). */
      defaultRootAnchor: string;
      distribution: AppDistribution;
    };

/** Contents of `.upriv-root` when the file exists (active or inactive). */
export type VaultRootAliasInfo = {
  path: string;
  active: boolean;
};

/** Status of `.upriv/` at the default-root anchor. */
export type VaultRootDirStatus = "absent" | "valid" | "incomplete" | "unreadable";

export type DefaultRootStatusResult = {
  status: VaultRootDirStatus;
  defaultRootAnchor: string;
};

/** Inspect `.upriv/` at an arbitrary absolute path (does not create/repair). */
export type VaultRootInspectResult = {
  status: VaultRootDirStatus;
  path: string;
};

/** How to replace an incomplete `.upriv/` when the UI confirms repair. */
export type IncompleteReplacePolicy = "delete" | "rename";

export const VAULT_ROOT_ALIAS_FILE = ".upriv-root";
