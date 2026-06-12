import type { VaultDisplayStatus } from "../vault/types";

/** CSS custom property names — single source for vault row/dot colors (SDD §8.2). */
export const vaultStatusColorVar = {
  open: "--vault-status-open",
  closed: "--vault-status-closed",
  sealed: "--vault-status-sealed",
  recovery: "--vault-status-recovery",
  closing: "--vault-status-closed",
  opening: "--vault-status-closed",
} as const satisfies Record<VaultDisplayStatus, string>;

/** i18n keys for status labels — maps display status → catalog key. */
export const vaultStatusI18nKey = {
  open: "vault.status.open",
  closed: "vault.status.closed",
  sealed: "vault.status.sealed",
  recovery: "vault.status.recovery",
  closing: "vault.status.closing",
  opening: "vault.status.opening",
} as const satisfies Record<VaultDisplayStatus, string>;

/** Brand wordmark variants (SDD §8.2.1). */
export const brandColors = {
  wordmarkWhite: "#FFFFFF",
  wordmarkBlack: "#000000",
  wordmarkNavy: "#0B0E1E",
  iconBg: "#0f172a",
} as const;
