import type { I18nKey } from "@/i18n";
import type { VaultDisplayStatus } from "@/types";

/** CSS custom property names — single source for vault row/dot colors (SDD §8.2). */
export const vaultStatusColorVar = {
  open: "--vault-status-open",
  closed: "--vault-status-closed",
  sealed: "--vault-status-sealed",
  recovery: "--vault-status-recovery",
} as const satisfies Record<VaultDisplayStatus, string>;

/** i18n keys for status labels — maps display status → catalog key. */
export const vaultStatusI18nKey = {
  open: "vault.status.open",
  closed: "vault.status.closed",
  sealed: "vault.status.sealed",
  recovery: "vault.status.recovery",
} as const satisfies Record<VaultDisplayStatus, I18nKey>;

/** Tailwind utility classes for row surface styling per status. */
export const vaultStatusRowClass = {
  open: "border-l-[3px] border-vault-open bg-vault-open/10",
  closed: "border-l-[3px] border-transparent bg-surface-container",
  sealed: "border-l-[3px] border-transparent bg-surface-container opacity-85",
  recovery: "border-l-[3px] border-vault-recovery bg-vault-recovery/10",
} as const satisfies Record<VaultDisplayStatus, string>;

/** Brand wordmark variants (SDD §8.2.1). */
export const brandColors = {
  wordmarkWhite: "#FFFFFF",
  wordmarkBlack: "#000000",
  wordmarkNavy: "#0B0E1E",
  iconBg: "#0f172a",
} as const;
