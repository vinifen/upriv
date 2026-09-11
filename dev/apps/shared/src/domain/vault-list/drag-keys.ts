export const LIST_ROOT_UNGROUP_DRAG_KEY = "list:ungroup";

const GROUPED_VAULT_DRAG_PREFIX = "grouped:";

export function listUngroupDragKey(groupId: string): string {
  return `list:ungroup:${groupId}`;
}

export function isListUngroupDragKey(key: string | null | undefined): boolean {
  return Boolean(key && (key === LIST_ROOT_UNGROUP_DRAG_KEY || key.startsWith("list:ungroup:")));
}

export function groupedVaultDragKey(groupId: string, vaultId: string): string {
  return `${GROUPED_VAULT_DRAG_PREFIX}${groupId}:${vaultId}`;
}

export function isGroupedVaultDragKey(key: string | null | undefined): boolean {
  return Boolean(key?.startsWith(GROUPED_VAULT_DRAG_PREFIX));
}

export function parseGroupedVaultDragKey(key: string): { groupId: string; vaultId: string } | null {
  if (!isGroupedVaultDragKey(key)) return null;
  const rest = key.slice(GROUPED_VAULT_DRAG_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const groupId = rest.slice(0, sep);
  const vaultId = rest.slice(sep + 1);
  if (!groupId || !vaultId) return null;
  return { groupId, vaultId };
}

/** Vault id when dragging a root vault row or a grouped vault row. */
export function sourceVaultIdFromDragKey(key: string): string | null {
  if (key.startsWith("vault:")) return key.slice("vault:".length);
  return parseGroupedVaultDragKey(key)?.vaultId ?? null;
}

/** True when `key` is a root or grouped drag of exactly `vaultId` (not a substring). */
export function dragKeyRefersToVaultId(key: string | null | undefined, vaultId: string): boolean {
  if (!key || !vaultId) return false;
  return sourceVaultIdFromDragKey(key) === vaultId;
}

/** Group id from a group header drop or a grouped-vault drop. */
export function targetGroupIdFromDropKey(key: string): string | null {
  if (key.startsWith("group:")) return key.slice("group:".length);
  return parseGroupedVaultDragKey(key)?.groupId ?? null;
}

/** Group id when dragging a vault row nested under a group. */
export function draggingGroupedVaultSourceGroupId(
  draggingId: string | null | undefined,
  vaultListAllowDragIntoGroup: boolean,
): string | null {
  if (!vaultListAllowDragIntoGroup || !isGroupedVaultDragKey(draggingId)) return null;
  return parseGroupedVaultDragKey(draggingId!)?.groupId ?? null;
}

/** Prefer the best drop key among hit targets for the current drag source. */
export function pickListDropTarget(
  keys: readonly string[],
  sourceKey: string | null | undefined,
): string | null {
  const candidates = keys.filter((key) => key && key !== sourceKey);
  if (candidates.length === 0) return null;

  if (isGroupedVaultDragKey(sourceKey)) {
    const sourceGroupId = parseGroupedVaultDragKey(sourceKey!)?.groupId;
    const groupedVaultTarget = candidates.find((key) => isGroupedVaultDragKey(key));
    if (groupedVaultTarget) return groupedVaultTarget;

    const inGroupUngroup =
      sourceGroupId && candidates.find((key) => key === listUngroupDragKey(sourceGroupId));
    if (inGroupUngroup) return inGroupUngroup;

    const otherGroup = candidates.find(
      (key) => key.startsWith("group:") && key !== `group:${sourceGroupId}`,
    );
    if (otherGroup) return otherGroup;

    const vaultTarget = candidates.find((key) => key.startsWith("vault:"));
    if (vaultTarget) return vaultTarget;

    const sameGroup = sourceGroupId && candidates.find((key) => key === `group:${sourceGroupId}`);
    if (sameGroup) return sameGroup;

    if (candidates.includes(LIST_ROOT_UNGROUP_DRAG_KEY)) {
      return LIST_ROOT_UNGROUP_DRAG_KEY;
    }

    return null;
  }

  if (sourceKey?.startsWith("group:")) {
    return (
      candidates.find((key) => key.startsWith("group:")) ??
      candidates.find((key) => key.startsWith("vault:")) ??
      candidates.find((key) => isGroupedVaultDragKey(key)) ??
      null
    );
  }

  if (sourceKey?.startsWith("vault:")) {
    return (
      candidates.find((key) => isGroupedVaultDragKey(key)) ??
      candidates.find((key) => key.startsWith("group:")) ??
      candidates.find((key) => key.startsWith("vault:")) ??
      null
    );
  }

  return candidates[0] ?? null;
}
