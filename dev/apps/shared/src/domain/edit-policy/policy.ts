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
  resolveVaultListStatus,
  type VaultDisplayStatus,
  type VaultPipelineListStatus,
  type VaultRow,
} from "../vault/types";
import type { I18nKey } from "../../i18n/catalog";
import contract from "./edit-policy.json";

export type ConfigEditGate =
  "anytime" | "vault_quiet" | "vault_closed" | "root_idle" | "no_open_session";

export const CONFIG_EDIT_GATES = contract.gates as readonly ConfigEditGate[];

export type VaultConfigEditTarget = keyof typeof contract.vault;
export type AppConfigEditTarget = keyof typeof contract.app;

export const VAULT_CONFIG_EDIT_TARGETS = Object.keys(contract.vault) as VaultConfigEditTarget[];

export const APP_CONFIG_EDIT_TARGETS = Object.keys(contract.app) as AppConfigEditTarget[];

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

/** Targets Rust `vault_config_save` refuses while session open / mid-close. */
export const RUST_CONFIG_SAVE_QUIET_TARGETS =
  contract.rustConfigSaveQuietTargets as readonly string[];

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
    case "root_idle":
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
  const gate = VAULT_CONFIG_EDIT_POLICY[target];
  return configEditGateAllows(gate, {
    vaultStatus: resolveVaultListStatus(row, pipeline),
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
export function vaultConfigEditLockedI18nKey(target: VaultConfigEditTarget): I18nKey | undefined {
  return VAULT_CONFIG_EDIT_LOCKED_I18N[target];
}

/** Locked hint for UI-facing targets that always have `lockedI18n` in the contract. */
export function requireVaultConfigEditLockedI18nKey(target: VaultConfigEditTarget): I18nKey {
  const key = vaultConfigEditLockedI18nKey(target);
  if (!key) {
    throw new Error(`edit-policy lockedI18n missing for ${target}`);
  }
  return key;
}
