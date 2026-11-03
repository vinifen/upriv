import type { I18nKey } from "../../i18n/catalog";
import type { VaultDeleteHold, VaultDisplayStatus, VaultPipelineListStatus } from "../vault/types";

/** CSS custom property names — single source for vault row/dot colors (SDD §8.2). */
export const vaultStatusColorVar = {
  open: "--vault-status-open",
  closed: "--vault-status-closed",
  recovery: "--vault-status-recovery",
  recovering: "--vault-status-closed",
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
  recovering: "vault.status.recovering",
  closing: "vault.status.closing",
  opening: "vault.status.opening",
  creating: "vault.status.creating",
  queued: "vault.status.queued",
  exporting: "vault.status.exporting",
  backing_up: "vault.status.backing_up",
  changing_password: "vault.status.changing_password",
  changing_kdf: "vault.status.changing_kdf",
} as const satisfies Record<VaultDisplayStatus, string>;

/** Why Delete waits (`vaultDeleteHold`): the danger zone line and its toast. */
export const VAULT_DELETE_HOLD_I18N_KEY = {
  busy: "modal.settings.delete_only_closed",
  backup_export: "modal.settings.delete_backup_export",
} as const satisfies Record<VaultDeleteHold, I18nKey>;

/** Row / badge / Info label. A closing vault in its backup phase says so. */
export function vaultStatusLabelKey(
  status: VaultDisplayStatus,
  vaultId: string,
  pipeline: VaultPipelineListStatus = {},
  autoClosed = false,
): I18nKey {
  const work = pipeline.rowWork?.[vaultId];
  if (work?.stop === "stopping") return "vault.status.stopping";
  // A job waiting for its lane has not started: it says so, and counts nothing.
  if (work && work.startedAt === null) return "vault.status.queued";
  if (status === "closing" && pipeline.backingUpVaultIds?.includes(vaultId)) {
    return "vault.status.backing_up";
  }
  if (status === "closed" && autoClosed) return "vault.status.auto_closed";
  return vaultStatusI18nKey[status];
}
