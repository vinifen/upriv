import type {
  IncompleteReplacePolicy,
  NearbyVaultRootStatusResult,
  VaultRootAliasInfo,
  VaultRootInspectResult,
  VaultRootResolveResult,
} from "../../domain/vault-root";
import type { VaultRootMode } from "../../domain/app-settings";

/**
 * Locate / create the Upriv vault-root (folder that contains `.upriv/`).
 * Desktop → daemon RPC; browser → mock.
 *
 * Disk-mutating methods (`setupNearby`, `setupAtPath`) should only be called from
 * `AppSettingsContext`, `VaultRootSetupModal`, `VaultRootRepairModal`, or
 * `VaultRootAliasRecoveryModal` — not from arbitrary UI — to avoid duplicate side effects.
 * Alias sync on settings save uses `app_settings_save` (`syncAlias`); there is no
 * separate rewrite/deactivate RPC on this service.
 */
export interface VaultRootService {
  /** Resolve using current app settings (`vault_root_mode` / custom path) + env/CLI when wired. */
  resolve(options?: {
    vaultRootMode?: VaultRootMode;
    explicitPath?: string | null;
    /** Debug-only; honored by daemon only when `UPRIV_DEV` is set. */
    binaryDir?: string | null;
  }): Promise<VaultRootResolveResult>;

  /**
   * Create default `.upriv/` beside the app (nearby anchor), deactivate `.upriv-root`
   * if it exists (path kept), and switch to nearby mode.
   * When replacing incomplete: `delete` removes `.upriv/`; `rename` keeps it as
   * `.upriv-invalidated-<timestamp>`.
   * `locale` is written into the new root's `settings.toml` `[ui].locale` when creating.
   */
  setupNearby(options?: {
    replaceIncomplete?: boolean;
    replacePolicy?: IncompleteReplacePolicy;
    locale?: string | null;
  }): Promise<{ rootPath: string }>;

  /**
   * Use `path` as vault-root (initialize if missing marker), write **active**
   * `.upriv-root` alias, and switch to custom-path mode (alias wins over local `.upriv`).
   * `path` must be absolute.
   * When replacing incomplete: same policies as `setupNearby`.
   */
  setupAtPath(
    path: string,
    options?: {
      replaceIncomplete?: boolean;
      replacePolicy?: IncompleteReplacePolicy;
      locale?: string | null;
    },
  ): Promise<{ rootPath: string; aliasPath: string }>;

  /** Read remembered `.upriv-root` path (active or inactive). Missing file → `null`. */
  readAlias(): Promise<VaultRootAliasInfo | null>;

  /** Inspect `.upriv/` beside the app without creating or repairing it. */
  nearbyStatus(): Promise<NearbyVaultRootStatusResult>;

  /** Inspect `.upriv/` at an absolute path without creating or repairing it. */
  inspectAtPath(path: string): Promise<VaultRootInspectResult>;

  /**
   * Native folder picker when available; otherwise `null` (UI falls back to text path).
   * `defaultPath` pre-selects that folder in the dialog when supported.
   * `title` is the dialog title (i18n from the renderer).
   */
  pickFolder(defaultPath?: string | null, title?: string | null): Promise<string | null>;
}
