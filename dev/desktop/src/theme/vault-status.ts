import type { I18nKey } from "@/i18n";
import type { VaultDisplayStatus } from "@upriv/shared";
import {
  brandColors as sharedBrandColors,
  vaultStatusColorVar as sharedVaultStatusColorVar,
  vaultStatusI18nKey as sharedVaultStatusI18nKey,
} from "@upriv/shared";

/** CSS custom property names — single source for vault row/dot colors (SDD §8.2). */
export const vaultStatusColorVar = sharedVaultStatusColorVar;

/** i18n keys for status labels — maps display status → catalog key. */
export const vaultStatusI18nKey = sharedVaultStatusI18nKey as Record<VaultDisplayStatus, I18nKey>;

/** Tailwind utility classes for row surface styling per status. */
export const vaultStatusRowClass = {
  open: "border-l-2 border-vault-open bg-surface-container hover:bg-surface-row-hover [&:has(button:hover)]:bg-surface-container",
  closed:
    "bg-surface-container hover:bg-surface-row-hover [&:has(button:hover)]:bg-surface-container",
  sealed:
    "bg-surface-container opacity-90 hover:bg-surface-row-hover [&:has(button:hover)]:bg-surface-container",
  recovery:
    "border-l-2 border-vault-recovery bg-vault-recovery/10 hover:bg-surface-row-hover [&:has(button:hover)]:bg-surface-container",
  closing:
    "border-l-2 border-vault-closed/60 bg-surface-container opacity-95 hover:bg-surface-row-hover [&:has(button:hover)]:bg-surface-container",
  opening:
    "border-l-2 border-vault-closed/60 bg-surface-container opacity-95 hover:bg-surface-row-hover [&:has(button:hover)]:bg-surface-container",
} as const satisfies Record<VaultDisplayStatus, string>;

/** Status badge (uppercase mono chip) per display status. */
export const vaultStatusBadgeClass = {
  open: "bg-[var(--vault-open-badge-bg)] text-vault-open",
  closed: "bg-surface-container-highest text-on-surface-variant",
  sealed: "bg-surface-container-highest text-on-surface-variant",
  recovery: "bg-[var(--vault-recovery-badge-bg)] text-vault-recovery",
  closing: "bg-surface-container-highest text-on-surface-variant animate-pulse",
  opening: "bg-surface-container-highest text-on-surface-variant animate-pulse",
} as const satisfies Record<VaultDisplayStatus, string>;

/** Leading circle icon tint on vault row. */
export const vaultStatusIconClass = {
  open: "bg-vault-open/10 text-vault-open",
  closed: "bg-surface-container-highest text-on-surface-variant",
  sealed: "bg-surface-container-highest text-on-surface-variant",
  recovery: "bg-vault-recovery/15 text-vault-recovery",
  closing: "bg-surface-container-highest text-on-surface-variant",
  opening: "bg-surface-container-highest text-on-surface-variant",
} as const satisfies Record<VaultDisplayStatus, string>;

/** Brand wordmark variants (SDD §8.2.1). */
export const brandColors = sharedBrandColors;
