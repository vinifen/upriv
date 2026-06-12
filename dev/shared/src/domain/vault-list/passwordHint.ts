import type { VaultListItem } from "./types";

/** Password hint from list row (enriched by VaultService on load). */
export function resolveVaultPasswordHint(
  vault: Pick<VaultListItem, "id" | "passwordHint">,
): string | undefined {
  const fromRow = vault.passwordHint?.trim();
  return fromRow || undefined;
}
