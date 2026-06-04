import type { VaultListItem } from "./types";

/** Default list sort — `[vault] order` ascending, then display name (PRD §3.7.1). */
export function sortVaultsByOrder(vaults: VaultListItem[]): VaultListItem[] {
  return [...vaults].sort((a, b) => {
    const orderDiff = (a.order ?? 999) - (b.order ?? 999);
    if (orderDiff !== 0) return orderDiff;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
  });
}

/** Swap the dragged vault with the drop target row; reassign `order` 1…n (local state until config save exists). */
export function reorderVaultList(
  vaults: VaultListItem[],
  draggedId: string,
  targetId: string,
): VaultListItem[] {
  if (draggedId === targetId) return vaults;

  const sorted = sortVaultsByOrder(vaults);
  const fromIndex = sorted.findIndex((v) => v.id === draggedId);
  const toIndex = sorted.findIndex((v) => v.id === targetId);
  if (fromIndex < 0 || toIndex < 0) return vaults;

  const next = [...sorted];
  [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];

  return next.map((vault, index) => ({
    ...vault,
    order: index + 1,
    note: vault.note ?? "",
  }));
}
