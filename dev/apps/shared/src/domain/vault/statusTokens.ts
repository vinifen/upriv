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
} as const satisfies Record<VaultDisplayStatus, string>;

/** Row / badge / Info label. A closing vault in its backup phase says so. */
export function vaultStatusLabelKey(
  status: VaultDisplayStatus,
  vaultId: string,
  pipeline: VaultPipelineListStatus = {},
): I18nKey {
  if (status === "closing" && pipeline.backingUpVaultIds?.includes(vaultId)) {
    return "vault.status.backing_up";
  }
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

/** Brand wordmark variants (SDD §8.2.1). */
export const brandColors = {
  wordmarkWhite: "#FFFFFF",
  wordmarkBlack: "#000000",
  wordmarkNavy: "#0B0E1E",
  iconBg: "#0f172a",
} as const;
