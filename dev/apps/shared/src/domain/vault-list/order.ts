import { baseCollator } from "../format/intl";
import type { VaultListItem } from "./types";

/** Default list sort — `[vault] order` ascending, then display name (PRD §3.7.1). */
export function sortVaultsByOrder(vaults: VaultListItem[]): VaultListItem[] {
  const collator = baseCollator();
  return [...vaults].sort((a, b) => {
    const orderDiff = (a.order ?? 999) - (b.order ?? 999);
    if (orderDiff !== 0) return orderDiff;
    return collator.compare(a.displayName, b.displayName);
  });
}
