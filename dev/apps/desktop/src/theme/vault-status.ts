import type { I18nKey } from "@/i18n";
import type { VaultDisplayStatus } from "@upriv/shared";
import {
  vaultStatusColorVar as sharedVaultStatusColorVar,
  vaultStatusI18nKey as sharedVaultStatusI18nKey,
} from "@upriv/shared";

/** CSS custom property names — single source for vault row/dot colors (SDD §8.2). */
export const vaultStatusColorVar = sharedVaultStatusColorVar;

/** i18n keys for status labels — maps display status → catalog key. */
export const vaultStatusI18nKey = sharedVaultStatusI18nKey as Record<VaultDisplayStatus, I18nKey>;

// Left accent is drawn as a `::before` overlay that copies the card's rounded shape but
// is clipped to a thin left band (`clip-path`). This keeps the curved corner on the left
// while guaranteeing nothing is painted on the right-hand corners (no stray pixel).
const accentStripeBase =
  "relative before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border-l-2 before:[clip-path:inset(0_calc(100%-12px)_0_0)] before:content-['']";

export const vaultStatusRowClass = {
  open: `${accentStripeBase} before:border-[var(--vault-status-open)] bg-surface-container hover:bg-surface-row-hover [&:has(button:hover)]:bg-surface-container`,
  closed:
    "bg-surface-container hover:bg-surface-row-hover [&:has(button:hover)]:bg-surface-container",
  sealed:
    "bg-surface-container opacity-90 hover:bg-surface-row-hover [&:has(button:hover)]:bg-surface-container",
  recovery: `${accentStripeBase} before:border-[var(--vault-status-recovery)] bg-vault-recovery/10 hover:bg-surface-row-hover [&:has(button:hover)]:bg-surface-container`,
  closing: `${accentStripeBase} before:border-[color-mix(in_srgb,var(--vault-status-closed)_60%,transparent)] bg-surface-container opacity-95 hover:bg-surface-row-hover [&:has(button:hover)]:bg-surface-container`,
  opening: `${accentStripeBase} before:border-[color-mix(in_srgb,var(--vault-status-closed)_60%,transparent)] bg-surface-container opacity-95 hover:bg-surface-row-hover [&:has(button:hover)]:bg-surface-container`,
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
