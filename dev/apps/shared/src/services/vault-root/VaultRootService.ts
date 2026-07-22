import type {
  IncompleteReplacePolicy,
  DefaultRootStatusResult,
  VaultRootAliasInfo,
  VaultRootInspectResult,
  VaultRootResolveResult,
} from "../../domain/vault-root";
import type { VaultRootMode } from "../../domain/app-settings";

/**
 * Locate / create the Upriv vault-root (folder that contains `.upriv/`).
 * Desktop → daemon RPC; browser → mock.
 *
 * Disk-mutating methods (`setupDefaultRoot`, `setupAtPath`) should only be called from
 * `AppSettingsContext`, `VaultRootSetupModal`, `VaultRootRepairModal`, or
 * `VaultRootAliasRecoveryModal` — not from arbitrary UI — to avoid duplicate side effects.
 * Alias sync on settings save uses `app_settings_save` (`syncAlias`); there is no
 * separate rewrite/deactivate RPC on this service.
 *
 * **Locale:** every `setup*` call site must pass `settings.ui.locale` (or the pending
 * in-memory locale) so a new root’s `settings.toml` is not stuck on the English default.
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
   * `locale` is written into the new root's `settings.toml` `[ui].locale` when creating.
   */
  setupDefaultRoot(options?: {
    replaceIncomplete?: boolean;
    replacePolicy?: IncompleteReplacePolicy;
    locale?: string | null;
  }): Promise<{ rootPath: string }>;

  /**
   * Use `path` as vault-root (initialize if missing marker), write **active**
   * `.upriv-root` alias, and switch to custom-path mode (alias wins over local `.upriv`).
   * `path` must be absolute.
   * When replacing incomplete: same policies as `setupDefaultRoot`.
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
