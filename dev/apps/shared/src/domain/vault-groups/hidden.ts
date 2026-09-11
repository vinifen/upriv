import type { VaultGroup } from "./types";

/** Vault ids that belong to a hidden group (exclusive membership). */
export function vaultIdsInHiddenGroups(groups: readonly VaultGroup[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (!group.hidden) continue;
    for (const id of group.groupedVaults) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function isVaultInHiddenGroup(groups: readonly VaultGroup[], vaultId: string): boolean {
  return groups.some((group) => group.hidden && group.groupedVaults.includes(vaultId));
}

export function isHiddenGroup(groups: readonly VaultGroup[], groupId: string): boolean {
  const id = groupId.trim();
  if (!id) return false;
  return groups.some((group) => group.hidden && group.id === id);
}

/** Members of groups that flipped from hidden → visible (delete does not unhide). */
export function vaultIdsUnhiddenByGroups(
  previous: readonly VaultGroup[],
  next: readonly VaultGroup[],
): string[] {
  const nextById = new Map(next.map((group) => [group.id, group]));
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const group of previous) {
    if (!group.hidden) continue;
    const updated = nextById.get(group.id);
    if (!updated || updated.hidden) continue;
    for (const id of updated.groupedVaults) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Groups shown in assignment pickers. Always keeps `selectedGroupId` if present. */
export function groupsForAssignmentPicker(
  groups: readonly VaultGroup[],
  options?: { includeHidden?: boolean; selectedGroupId?: string },
): VaultGroup[] {
  const includeHidden = options?.includeHidden ?? false;
  const selected = options?.selectedGroupId?.trim() ?? "";
  return groups.filter((group) => includeHidden || !group.hidden || group.id === selected);
}
