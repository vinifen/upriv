import type {
  IncompleteReplacePolicy,
  DefaultRootStatusResult,
  VaultRootAliasInfo,
  VaultRootBootstrapPrefs,
  VaultRootInspectResult,
  VaultRootResolveResult,
} from "../../domain/vault-root";
import type { VaultRootMode } from "../../domain/app-settings";

/**
 * Locate / create the Upriv vault-root (folder that contains `.upriv/`).
 * Desktop → daemon RPC; browser → mock.
 *
 * Disk-mutating methods (`setupDefaultRoot`, `setupAtPath`) should only be called from
 * `VaultRootDataFolderModal`, `VaultRootSetupModal`, `VaultRootRepairModal`, or
 * `VaultRootAliasRecoveryModal` — not from arbitrary UI or `AppSettingsContext` — to
 * avoid duplicate side effects. After setup*, Context only reloads via
 * `vaultRootAlreadyApplied`.
 * Alias sync on settings save uses `app_settings_save` (`syncAlias`); there is no
 * separate rewrite/deactivate RPC on this service.
 *
 * **Bootstrap prefs bag:** pre-root UI prefs applied only when creating a new
 * `.upriv/` (absent init or incomplete→replace). Today the only such pref is
 * `locale` (Gate selector), but future entries (theme, high-contrast, etc.)
 * extend the same [`VaultRootBootstrapPrefs`] bag without renaming these
 * service methods again. Selecting an already-valid vault-root ignores
 * `bootstrap` entirely — the daemon never rewrites that folder's
 * `[ui]` / `settings.toml`.
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
   * Create default `.upriv/` at the default root (default_root anchor), deactivate `.upriv-root`
   * if it exists (path kept), and switch to default-root mode.
   * When replacing incomplete: `delete` removes `.upriv/`; `rename` keeps it as
   * `.upriv-invalidated-<timestamp>`.
   * `bootstrap` seeds the new root's `settings.toml` (today `[ui].locale`).
   * Required (non-empty `bootstrap.locale`) when the target does not yet
   * contain a Valid `.upriv/`.
   */
  setupDefaultRoot(options?: {
    replaceIncomplete?: boolean;
    replacePolicy?: IncompleteReplacePolicy;
    bootstrap?: VaultRootBootstrapPrefs | null;
  }): Promise<{ rootPath: string }>;

  /**
   * Use `path` as vault-root (initialize if missing marker), write **active**
   * `.upriv-root` alias, and switch to custom-path mode (alias wins over local `.upriv`).
   * `path` must be absolute.
   * When replacing incomplete: same policies as `setupDefaultRoot`.
   * `bootstrap` seeds the new root's `settings.toml` on create — see
   * `setupDefaultRoot` for the same contract.
   */
  setupAtPath(
    path: string,
    options?: {
      replaceIncomplete?: boolean;
      replacePolicy?: IncompleteReplacePolicy;
      bootstrap?: VaultRootBootstrapPrefs | null;
    },
  ): Promise<{ rootPath: string; aliasPath: string }>;

  /** Read remembered `.upriv-root` path (active or inactive). Missing file → `null`. */
  readAlias(): Promise<VaultRootAliasInfo | null>;

  /** Inspect `.upriv/` at the default-root anchor without creating or repairing it. */
  defaultRootStatus(): Promise<DefaultRootStatusResult>;

  /** Inspect `.upriv/` at an absolute path without creating or repairing it. */
  inspectAtPath(path: string): Promise<VaultRootInspectResult>;

  /**
   * Suggested absolute path for the custom_root folder picker (`~/Documents/Upriv`).
   * Aligns with Rust `suggested_vault_root` / daemon RPC.
   */
  suggestedCustomRootPath(): Promise<string>;

  /**
   * Native folder picker when available; otherwise `null` (UI falls back to text path).
   * `defaultPath` pre-selects that folder in the dialog when supported.
   * `title` is the dialog title (i18n from the renderer).
   */
  pickFolder(defaultPath?: string | null, title?: string | null): Promise<string | null>;
}
