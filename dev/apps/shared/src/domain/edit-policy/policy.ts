/**
 * Product edit policy: what may change while a vault / root is busy.
 *
 * Contract: `./edit-policy.json` (bundled at runtime; Rust parity-tests the quiet list).
 * UI locks + `vault_config_save` backstop share this table.
 */

import {
  isVaultDisplayStatusQuiet,
  listHasVaultBlockingDataFolderChange,
  listHasVaultBlockingWorkspaceClear,
  resolveVaultDisplayStatus,
  resolveVaultListStatus,
  type VaultDisplayStatus,
  type VaultPipelineListStatus,
  type VaultRow,
} from "../vault/types";
import type { I18nKey } from "../../i18n/catalog";
import contract from "./edit-policy.json";

export type ConfigEditGate =
  | "anytime"
  | "vault_quiet"
  | "vault_closed"
  | "vault_closed_or_recovery"
  | "root_idle"
  | "no_open_session";

export type VaultConfigEditTarget = keyof typeof contract.vault;
export type AppConfigEditTarget = keyof typeof contract.app;

/** Hybrid product policy — see AGENT.md. Sourced from edit-policy.json. */
export const VAULT_CONFIG_EDIT_POLICY = contract.vault as Record<
  VaultConfigEditTarget,
  ConfigEditGate
>;

export const APP_CONFIG_EDIT_POLICY = contract.app as Record<AppConfigEditTarget, ConfigEditGate>;

/** Locked-field hint keys (missing target → no dedicated hint). */
export const VAULT_CONFIG_EDIT_LOCKED_I18N = contract.lockedI18n as Partial<
  Record<VaultConfigEditTarget, I18nKey>
>;

/** Targets core refuses (`plain_leftover`) until a leftover plaintext folder is removed. */
const PLAIN_LEFTOVER_LOCKED: ReadonlySet<string> = new Set(contract.plainLeftoverLocked);

export type ConfigEditContext = {
  vaultStatus?: VaultDisplayStatus;
  vaults?: readonly VaultRow[];
  pipeline?: VaultPipelineListStatus;
};

export function configEditGateAllows(gate: ConfigEditGate, ctx: ConfigEditContext): boolean {
  switch (gate) {
    case "anytime":
      return true;
    case "vault_quiet": {
      const status = ctx.vaultStatus;
      if (status == null) return false;
      return isVaultDisplayStatusQuiet(status);
    }
    case "vault_closed": {
      const status = ctx.vaultStatus;
      if (status == null) return false;
      return status === "closed";
    }
    case "vault_closed_or_recovery": {
      const status = ctx.vaultStatus;
      if (status == null) return false;
      return status === "closed" || status === "recovery";
    }
    case "root_idle":
      // An export copies the whole data folder, even one with no vaults.
      if (ctx.pipeline?.dataFolderExporting) return false;
      return !listHasVaultBlockingDataFolderChange(ctx.vaults ?? [], ctx.pipeline);
    case "no_open_session":
      return !listHasVaultBlockingWorkspaceClear(ctx.vaults ?? [], ctx.pipeline);
  }
}

export function vaultConfigEditAllowed(
  target: VaultConfigEditTarget,
  row: VaultRow,
  pipeline: VaultPipelineListStatus = {},
): boolean {
  if (row.plainLeftover && PLAIN_LEFTOVER_LOCKED.has(target)) return false;
  const gate = VAULT_CONFIG_EDIT_POLICY[target];
  let vaultStatus = resolveVaultListStatus(row, pipeline);
  if (vaultStatus === "queued" && resolveVaultDisplayStatus(row) === "open") {
    vaultStatus = "closing";
  }
  return configEditGateAllows(gate, {
    vaultStatus,
    vaults: [row],
    pipeline,
  });
}

export function appConfigEditAllowed(
  target: AppConfigEditTarget,
  vaults: readonly VaultRow[],
  pipeline: VaultPipelineListStatus = {},
): boolean {
  const gate = APP_CONFIG_EDIT_POLICY[target];
  return configEditGateAllows(gate, { vaults, pipeline });
}

/** i18n key when `vaultConfigEditAllowed` is false; undefined if no dedicated copy. */
export function vaultConfigEditLockedI18nKey(
  target: VaultConfigEditTarget,
  plainLeftover = false,
): I18nKey | undefined {
  if (plainLeftover && PLAIN_LEFTOVER_LOCKED.has(target)) {
    return contract.plainLeftoverLockedI18n as I18nKey;
  }
  return VAULT_CONFIG_EDIT_LOCKED_I18N[target];
}

/** Locked hint for UI-facing targets that always have `lockedI18n` in the contract. */
export function requireVaultConfigEditLockedI18nKey(
  target: VaultConfigEditTarget,
  plainLeftover = false,
): I18nKey {
  const key = vaultConfigEditLockedI18nKey(target, plainLeftover);
  if (!key) {
    throw new Error(`edit-policy lockedI18n missing for ${target}`);
  }
  return key;
}
