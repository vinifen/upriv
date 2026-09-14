/**
 * Finite loading budgets (ms) — every blocking UI load must use one of these
 * and show the budget to the user. Never wait forever.
 *
 * Keep `vaultRootSetup` / Gate in sync with `@upriv/shared` `CORE_RPC_TIMEOUT_MS`.
 */
export const LOADING_BUDGET_MS = {
  /** Data-folder setup / rename (Setup/Repair/Data-folder busy overlays). */
  vaultRoot: 600_000,
  /**
   * Gate applying overlay while waiting on `vault_root_resolve` (epoch bump / post-setup).
   * Keep in sync with `CORE_RPC_TIMEOUT_MS.vault_root_resolve`.
   */
  vaultRootResolve: 60_000,
  /** First settings load before Gate — keep in sync with `app_settings_get`. */
  settingsLoad: 60_000,
  /** Logs list / viewer fetch — keep in sync with `log_*` invoke timeouts. */
  logs: 60_000,
  /**
   * Vault settings submit: password / KDF change rewraps `vault.header` and the
   * key wrap in `contents/`, so a large vault can legitimately take minutes.
   */
  vaultRewrap: 600_000,
  /**
   * Scratch create in the vault pipeline queue (Argon2id wrap + seed chunk).
   * Same 10 min ceiling as other Argon2-bound ops — own key so it is not
   * mistaken for change-password. The create modal closes immediately; the
   * list row shows `creating` instead of a blocking overlay.
   */
  vaultCreate: 600_000,
  /**
   * Open/close pipeline progress (password modal if open + row hint; Argon2id
   * unlock + flush into `contents/`). Not a full-screen overlay.
   */
  vaultPipeline: 600_000,
  /**
   * Export `{display_name}.zip` of `contents/` or portable `.7z` (flush + pack).
   * Same family as `vaultRewrap`. Keep invoke in sync when the export RPC lands.
   */
  vaultExport: 600_000,
  /** Generic modal / list work. */
  default: 120_000,
  /** Settings Save / workspace path persist — keep in sync with `app_settings_save`. */
  settingsSave: 30_000,
} as const;

/**
 * Delay before showing loading UI. Fast ops finish under this and never flash a spinner.
 * Timeout / budget still counts from when the op started (`active`), not from first paint.
 */
export const LOADING_APPEAR_DELAY_MS = 1_000;

/**
 * Extra delay before showing the "up to 10 min" hint on long Argon2 / vault-root
 * budgets. Fast unlocks should not flash a 10-minute countdown.
 */
export const LOADING_LONG_HINT_APPEAR_DELAY_MS = 10_000;

/** Appear delay for a given budget — 10s for 10-minute ops, else 1s. */
export function loadingAppearDelayMs(budgetMs: number): number {
  return budgetMs >= 600_000 ? LOADING_LONG_HINT_APPEAR_DELAY_MS : LOADING_APPEAR_DELAY_MS;
}

export type LoadingBudgetKey = keyof typeof LOADING_BUDGET_MS;

export function formatLoadingRemaining(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Whole minutes for budgets ≥ 1 minute (hint copy). */
export function loadingBudgetMinutes(budgetMs: number): string {
  return String(Math.max(1, Math.round(budgetMs / 60_000)));
}

/** Whole seconds for budgets under 1 minute (hint copy). */
export function loadingBudgetSeconds(budgetMs: number): string {
  return String(Math.max(1, Math.ceil(budgetMs / 1000)));
}

export function loadingBudgetUsesMinutes(budgetMs: number): boolean {
  return budgetMs >= 60_000;
}
