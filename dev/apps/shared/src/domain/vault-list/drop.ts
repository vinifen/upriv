import {
  isListUngroupDragKey,
  parseGroupedVaultDragKey,
  sourceVaultIdFromDragKey,
  targetGroupIdFromDropKey,
} from "./drag-keys";

export type ListDropResolution =
  | { kind: "noop" }
  | { kind: "reorder-root" }
  | {
      kind: "reorder-grouped";
      groupId: string;
      draggedVaultId: string;
      targetVaultId: string;
    }
  | {
      kind: "assign-to-group";
      vaultId: string;
      targetGroupId: string;
      beforeVaultId: string | null;
    }
  | { kind: "ungroup"; vaultId: string; beforeVaultId: string | null }
  | { kind: "blocked-reorder-root" }
  | { kind: "blocked-reorder-grouped" };

export type ResolveListDropInput = {
  sourceKey: string;
  targetKey: string | null;
  canReorderRoot: boolean;
  allowDragIntoGroup: boolean;
  canReorderGrouped: (groupId: string) => boolean;
};

function isBlockedListDrop(kind: ListDropResolution["kind"]): boolean {
  return kind === "blocked-reorder-root" || kind === "blocked-reorder-grouped";
}

/** Hover ring: accent when the drop applies, recovery when it does not. */
export function listDropHighlight(kind: ListDropResolution["kind"]): "valid" | "blocked" | "none" {
  if (isBlockedListDrop(kind)) return "blocked";
  if (kind === "noop") return "none";
  return "valid";
}

/**
 * Classify a vault-list pointer drop.
 * When sort is not `order`, the only membership move is onto a group (or the
 * ungroup zone). Dropping onto a vault/group to change list order is blocked.
 */
export function resolveListDrop(input: ResolveListDropInput): ListDropResolution {
  const { sourceKey, targetKey, canReorderRoot, allowDragIntoGroup, canReorderGrouped } = input;
  if (!targetKey || targetKey === sourceKey) return { kind: "noop" };

  const sourceGrouped = parseGroupedVaultDragKey(sourceKey);
  const sourceVaultId = sourceVaultIdFromDragKey(sourceKey);
  const sourceGroupId = sourceGrouped?.groupId ?? null;
  const targetGrouped = parseGroupedVaultDragKey(targetKey);
  const targetGroupId = targetGroupIdFromDropKey(targetKey);

  if (
    sourceGrouped &&
    sourceVaultId &&
    sourceGroupId &&
    targetGrouped?.vaultId &&
    sourceGroupId === targetGrouped.groupId
  ) {
    if (canReorderGrouped(sourceGroupId)) {
      return {
        kind: "reorder-grouped",
        groupId: sourceGroupId,
        draggedVaultId: sourceVaultId,
        targetVaultId: targetGrouped.vaultId,
      };
    }
    return { kind: "blocked-reorder-grouped" };
  }

  if (sourceGrouped && sourceVaultId && allowDragIntoGroup && isListUngroupDragKey(targetKey)) {
    return { kind: "ungroup", vaultId: sourceVaultId, beforeVaultId: null };
  }

  if (sourceGrouped && sourceVaultId && targetKey.startsWith("vault:")) {
    if (allowDragIntoGroup && canReorderRoot) {
      return {
        kind: "ungroup",
        vaultId: sourceVaultId,
        beforeVaultId: targetKey.slice("vault:".length),
      };
    }
    if (!canReorderRoot) {
      return { kind: "blocked-reorder-root" };
    }
    return { kind: "noop" };
  }

  if (sourceVaultId && targetGroupId && allowDragIntoGroup && sourceGroupId !== targetGroupId) {
    return {
      kind: "assign-to-group",
      vaultId: sourceVaultId,
      targetGroupId,
      beforeVaultId: targetGrouped?.vaultId ?? null,
    };
  }

  if (
    !sourceGrouped &&
    !targetGrouped &&
    !isListUngroupDragKey(targetKey) &&
    (targetKey.startsWith("vault:") || targetKey.startsWith("group:"))
  ) {
    if (canReorderRoot) return { kind: "reorder-root" };
    return { kind: "blocked-reorder-root" };
  }

  return { kind: "noop" };
}
