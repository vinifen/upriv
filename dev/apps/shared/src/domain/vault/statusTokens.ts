import type { I18nKey } from "../../i18n/catalog";
import type { VaultDisplayStatus, VaultPipelineListStatus } from "../vault/types";

/** CSS custom property names — single source for vault row/dot colors (SDD §8.2). */
export const vaultStatusColorVar = {
  open: "--vault-status-open",
  closed: "--vault-status-closed",
  recovery: "--vault-status-recovery",
  closing: "--vault-status-closed",
  opening: "--vault-status-closed",
  creating: "--vault-status-closed",
  queued: "--vault-status-closed",
  exporting: "--vault-status-closed",
  backing_up: "--vault-status-closed",
  changing_password: "--vault-status-closed",
  changing_kdf: "--vault-status-closed",
} as const satisfies Record<VaultDisplayStatus, string>;

/** i18n keys for status labels — maps display status → catalog key. */
export const vaultStatusI18nKey = {
  open: "vault.status.open",
  closed: "vault.status.closed",
  recovery: "vault.status.recovery",
  closing: "vault.status.closing",
  opening: "vault.status.opening",
  creating: "vault.status.creating",
  queued: "vault.status.queued",
  exporting: "vault.status.exporting",
  backing_up: "vault.status.backing_up",
  changing_password: "vault.status.changing_password",
  changing_kdf: "vault.status.changing_kdf",
} as const satisfies Record<VaultDisplayStatus, string>;

/** Row / badge / Info label. A closing vault in its backup phase says so. */
export function vaultStatusLabelKey(
  status: VaultDisplayStatus,
  vaultId: string,
  pipeline: VaultPipelineListStatus = {},
  autoClosed = false,
): I18nKey {
  if (status === "closing" && pipeline.backingUpVaultIds?.includes(vaultId)) {
    return "vault.status.backing_up";
  }
  if (status === "closed" && autoClosed) return "vault.status.auto_closed";
  return vaultStatusI18nKey[status];
}

/** File-manager chrome while this vault is closing. `null` when it is not. */
export function vaultCloseActivityLabelKey(
  vaultId: string,
  pipeline: VaultPipelineListStatus = {},
): I18nKey | null {
  if (!pipeline.closingVaultIds?.includes(vaultId)) return null;
  if (pipeline.backingUpVaultIds?.includes(vaultId)) return "vault.status.backing_up";
  return "vault.status.closing";
}
