/**
 * Finite loading budgets (ms) — every blocking UI load must use one of these
 * and show the budget to the user. Never wait forever.
 *
 * Keep `vaultRootSetup` / Gate in sync with desktop `invoke.ts` method timeouts.
 */
export const LOADING_BUDGET_MS = {
  /** Data-folder setup / rename (Setup/Repair/Data-folder busy overlays). */
  vaultRoot: 600_000,
  /**
   * Gate applying overlay while waiting on `vault_root_resolve` (epoch bump / post-setup).
   * Keep in sync with desktop `METHOD_TIMEOUT_MS.vault_root_resolve`.
   */
  vaultRootResolve: 60_000,
  /** First settings load before Gate — keep in sync with `app_settings_get`. */
  settingsLoad: 60_000,
  /** Logs list / viewer fetch — keep in sync with `log_*` invoke timeouts. */
  logs: 60_000,
  /** Generic modal / list work. */
  default: 120_000,
} as const;

/**
 * Delay before showing loading UI. Fast ops finish under this and never flash a spinner.
 * Timeout / budget still counts from when the op started (`active`), not from first paint.
 */
export const LOADING_APPEAR_DELAY_MS = 1_000;

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
