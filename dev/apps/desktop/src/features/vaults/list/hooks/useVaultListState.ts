import { useCallback, useMemo, useState } from "react";
import {
  VAULT_NOTE_MAX_LENGTH,
  DEFAULT_VAULT_LIST_VIEW,
  type VaultListViewMode,
  assertPlainVaultInvariant,
  type VaultPersistence,
  type VaultSession,
  type VaultSettingsListPatch,
  type VaultListItem,
  type VaultGroup,
  applyVaultListHierarchySort,
  canReorderGroupedVaults,
  canReorderVaultList,
  DEFAULT_VAULT_LIST_SORT,
  type VaultListSort,
  type VaultListRootRow,
  groupedVaultSortOf,
  normalizeVaultGroup,
  reorderRootRows,
  reorderGroupedVaults,
  rootRowDragKey,
  assignVaultToGroup,
  removeVaultFromGroups,
  insertUngroupedVaultAtRoot,
  resolveVaultPasswordHint,
  sortVaultsByOrder,
} from "@upriv/shared";
import { isOsFileDrag } from "@/features/vaults/file-manager/lib/osFileDrop";
import { registerMockVaultId, unregisterMockVaultId } from "@/platform/mocks/data/vaults";

function seedVaultPasswordHints(vaults: VaultListItem[]): VaultListItem[] {
  return vaults.map((vault) => {
    assertPlainVaultInvariant(vault);
    const passwordHint = resolveVaultPasswordHint(vault);
    return passwordHint ? { ...vault, passwordHint } : vault;
  });
}

const ROOT_DRAG_MIME = "application/x-upriv-root-row";
const MEMBER_DRAG_MIME = "application/x-upriv-group-member";
const LIST_UNGROUP_DRAG_KEY = "list:ungroup";

function readMemberDrag(
  event: React.DragEvent,
  draggingId: string | null,
): { groupId: string; vaultId: string } | null {
  const raw = event.dataTransfer.getData(MEMBER_DRAG_MIME);
  if (raw) {
    const [groupId, vaultId] = raw.split("\t");
    if (groupId && vaultId) return { groupId, vaultId };
  }
  if (draggingId?.startsWith("member:")) {
    const parts = draggingId.split(":");
    const groupId = parts[1];
    const vaultId = parts[2];
    if (groupId && vaultId) return { groupId, vaultId };
  }
  return null;
}

export function useVaultListState(
  initialVaults: VaultListItem[],
  options?: {
    initialSort?: VaultListSort;
    initialViewMode?: VaultListViewMode;
    showHiddenVaults?: boolean;
    reloadVaults?: () => Promise<VaultListItem[]>;
    initialGroups?: VaultGroup[];
    /** Persist in-group vault order after drag (mock/RPC). Required so collapse reload keeps order. */
    onGroupedVaultsReordered?: (groupId: string, groupedVaults: string[]) => void;
    /** Persist group `order` after a root-row drop (one RPC).
     * Vault `order` is updated locally for session DnD only — there is no vault-order
     * RPC yet (`vault_list` / settings order). After refresh, vault positions snap back. */
    onRootGroupsReordered?: (orders: { id: string; order: number }[]) => void;
    /** Drop a vault onto a group (ungrouped or cross-group). Default true. */
    allowDragVaultIntoGroup?: boolean;
    onVaultAssignedToGroup?: (targetGroupId: string, groupedVaults: string[]) => void;
  },
) {
  const reloadVaults = options?.reloadVaults;
  const onGroupedVaultsReordered = options?.onGroupedVaultsReordered;
  const onRootGroupsReordered = options?.onRootGroupsReordered;
  const allowDragVaultIntoGroup = options?.allowDragVaultIntoGroup !== false;
  const onVaultAssignedToGroup = options?.onVaultAssignedToGroup;
  const [isReady, setIsReady] = useState(initialVaults.length > 0);
  const [vaults, setVaults] = useState(() =>
    sortVaultsByOrder(seedVaultPasswordHints(initialVaults)),
  );
  const [groups, setGroups] = useState<VaultGroup[]>(() =>
    (options?.initialGroups ?? []).map((g) =>
      normalizeVaultGroup({ ...g, groupedVaults: [...g.groupedVaults] }),
    ),
  );
  const [groupsInvalid, setGroupsInvalid] = useState(false);
  const [groupsInvalidDismissed, setGroupsInvalidDismissed] = useState(false);
  const [sort, setSort] = useState<VaultListSort>(options?.initialSort ?? DEFAULT_VAULT_LIST_SORT);
  const [viewMode, setViewMode] = useState<VaultListViewMode>(
    options?.initialViewMode ?? DEFAULT_VAULT_LIST_VIEW,
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const showHiddenVaults = options?.showHiddenVaults ?? false;

  const displayRows = useMemo(() => {
    return applyVaultListHierarchySort(vaults, groups, sort, { showHiddenVaults });
  }, [vaults, groups, sort, showHiddenVaults]);

  const displayVaults = useMemo(() => {
    const out: VaultListItem[] = [];
    for (const row of displayRows) {
      if (row.kind === "vault") out.push(row.vault);
      else if (!row.group.collapsed) out.push(...row.groupedVaults);
    }
    return out;
  }, [displayRows]);

  const canReorder = canReorderVaultList(sort);

  const initializeVaults = useCallback((rows: VaultListItem[]) => {
    setVaults(sortVaultsByOrder(seedVaultPasswordHints(rows)));
    setIsReady(true);
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  const initializeGroups = useCallback((next: VaultGroup[], invalid = false) => {
    setGroups(next.map((g) => normalizeVaultGroup({ ...g, groupedVaults: [...g.groupedVaults] })));
    setGroupsInvalid(invalid);
    if (!invalid) setGroupsInvalidDismissed(false);
  }, []);

  const resetList = useCallback(async () => {
    if (reloadVaults) {
      const rows = await reloadVaults();
      initializeVaults(rows);
      return;
    }
    initializeVaults(initialVaults);
  }, [initialVaults, reloadVaults, initializeVaults]);

  const onRootDragStart = useCallback(
    (row: VaultListRootRow) => {
      return (event: React.DragEvent) => {
        const isVault = row.kind === "vault";
        if (!canReorder && !(allowDragVaultIntoGroup && isVault)) return;
        const key = rootRowDragKey(row);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(ROOT_DRAG_MIME, key);
        setDraggingId(key);
      };
    },
    [allowDragVaultIntoGroup, canReorder],
  );

  const onMemberDragStart = useCallback(
    (groupId: string, vaultId: string) => {
      return (event: React.DragEvent) => {
        const group = groups.find((g) => g.id === groupId);
        if (!group) return;
        const canReorderInGroup = canReorderGroupedVaults(groupedVaultSortOf(group));
        if (!canReorderInGroup && !allowDragVaultIntoGroup) return;
        const key = `member:${groupId}:${vaultId}`;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(MEMBER_DRAG_MIME, `${groupId}\t${vaultId}`);
        setDraggingId(key);
      };
    },
    [allowDragVaultIntoGroup, groups],
  );

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  const onRootDragOver = useCallback(
    (row: VaultListRootRow) => {
      return (event: React.DragEvent) => {
        if (isOsFileDrag(event)) return;
        const memberDrag = draggingId?.startsWith("member:");
        const vaultDrag = draggingId?.startsWith("vault:");
        const groupDrag = draggingId?.startsWith("group:");
        if (row.kind === "group") {
          const acceptAssign =
            allowDragVaultIntoGroup && Boolean(memberDrag || vaultDrag);
          const acceptReorder = canReorder && Boolean(groupDrag || vaultDrag);
          if (!acceptAssign && !acceptReorder) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDragOverId(rootRowDragKey(row));
          return;
        }
        const acceptUngroup = allowDragVaultIntoGroup && Boolean(memberDrag);
        const acceptReorder = canReorder && Boolean(vaultDrag || groupDrag);
        if (!acceptUngroup && !acceptReorder) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDragOverId(rootRowDragKey(row));
      };
    },
    [allowDragVaultIntoGroup, canReorder, draggingId],
  );

  const onMemberDragOver = useCallback(
    (groupId: string, vaultId: string) => {
      return (event: React.DragEvent) => {
        if (isOsFileDrag(event)) return;
        const group = groups.find((g) => g.id === groupId);
        if (!group) return;
        const canReorderInGroup = canReorderGroupedVaults(groupedVaultSortOf(group));
        const memberDrag = draggingId?.startsWith("member:");
        const vaultDrag = draggingId?.startsWith("vault:");
        const sourceGroupId = memberDrag ? draggingId?.split(":")[1] : null;
        const sameGroupReorder = memberDrag && sourceGroupId === groupId && canReorderInGroup;
        const assignInto =
          allowDragVaultIntoGroup && (vaultDrag || (memberDrag && sourceGroupId !== groupId));
        if (!sameGroupReorder && !assignInto) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDragOverId(`member:${groupId}:${vaultId}`);
      };
    },
    [allowDragVaultIntoGroup, draggingId, groups],
  );

  const onDragLeave = useCallback((id: string) => {
    return () => {
      setDragOverId((current) => (current === id ? null : current));
    };
  }, []);

  const commitAssignToGroup = useCallback(
    (vaultId: string, targetGroupId: string, beforeVaultId?: string | null) => {
      const source = groups.find((g) => g.groupedVaults.includes(vaultId));
      if (source?.id === targetGroupId && !beforeVaultId) return;
      const nextGroups = assignVaultToGroup(groups, vaultId, targetGroupId, beforeVaultId);
      setGroups(nextGroups);
      const target = nextGroups.find((g) => g.id === targetGroupId);
      if (target) onVaultAssignedToGroup?.(targetGroupId, target.groupedVaults);
    },
    [groups, onVaultAssignedToGroup],
  );

  const commitUngroup = useCallback(
    (vaultId: string, beforeVaultId?: string | null) => {
      const source = groups.find((g) => g.groupedVaults.includes(vaultId));
      if (!source) return;
      const remaining = source.groupedVaults.filter((id) => id !== vaultId);
      let nextGroups = removeVaultFromGroups(groups, vaultId);
      let nextVaults = vaults;
      if (canReorder) {
        const vault = vaults.find((item) => item.id === vaultId);
        if (vault) {
          const nextRows = insertUngroupedVaultAtRoot(displayRows, vault, beforeVaultId);
          nextVaults = vaults.map((item) => {
            const row = nextRows.find((r) => r.kind === "vault" && r.vault.id === item.id);
            return row && row.kind === "vault" ? { ...item, order: row.vault.order } : item;
          });
          nextGroups = nextGroups.map((group) => {
            const row = nextRows.find((r) => r.kind === "group" && r.group.id === group.id);
            return row && row.kind === "group" ? { ...group, order: row.group.order } : group;
          });
          const orders = nextGroups
            .filter((group) => groups.find((g) => g.id === group.id)?.order !== group.order)
            .map((group) => ({ id: group.id, order: group.order }));
          if (orders.length > 0) onRootGroupsReordered?.(orders);
        }
      }
      setVaults(nextVaults);
      setGroups(nextGroups);
      onVaultAssignedToGroup?.(source.id, remaining);
    },
    [
      canReorder,
      displayRows,
      groups,
      onRootGroupsReordered,
      onVaultAssignedToGroup,
      vaults,
    ],
  );

  const onUngroupDragOver = useCallback(
    (event: React.DragEvent) => {
      if (isOsFileDrag(event)) return;
      if (!allowDragVaultIntoGroup || !draggingId?.startsWith("member:")) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDragOverId(LIST_UNGROUP_DRAG_KEY);
    },
    [allowDragVaultIntoGroup, draggingId],
  );

  const onUngroupDrop = useCallback(
    (event: React.DragEvent) => {
      if (isOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const member = readMemberDrag(event, draggingId);
      if (member && allowDragVaultIntoGroup) {
        commitUngroup(member.vaultId);
      }
      setDraggingId(null);
      setDragOverId(null);
    },
    [allowDragVaultIntoGroup, commitUngroup, draggingId],
  );

  const onRootDrop = useCallback(
    (target: VaultListRootRow) => {
      return (event: React.DragEvent) => {
        if (isOsFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const targetKey = rootRowDragKey(target);
        const member = readMemberDrag(event, draggingId);
        const rootRaw = event.dataTransfer.getData(ROOT_DRAG_MIME) || draggingId;

        if (target.kind === "vault" && member && allowDragVaultIntoGroup) {
          commitUngroup(member.vaultId, canReorder ? target.vault.id : null);
          setDraggingId(null);
          setDragOverId(null);
          return;
        }

        if (target.kind === "group") {
          const vaultId = member
            ? member.vaultId
            : rootRaw?.startsWith("vault:")
              ? rootRaw.slice("vault:".length)
              : null;
          if (vaultId && allowDragVaultIntoGroup) {
            commitAssignToGroup(vaultId, target.group.id);
            setDraggingId(null);
            setDragOverId(null);
            return;
          }
        }

        if (!canReorder) {
          setDraggingId(null);
          setDragOverId(null);
          return;
        }
        const draggedKey = rootRaw;
        if (draggedKey && draggedKey !== targetKey && !draggedKey.startsWith("member:")) {
          const nextRows = reorderRootRows(displayRows, draggedKey, targetKey);
          const nextVaults = vaults.map((vault) => {
            const row = nextRows.find((r) => r.kind === "vault" && r.vault.id === vault.id);
            return row && row.kind === "vault" ? { ...vault, order: row.vault.order } : vault;
          });
          const nextGroups = groups.map((group) => {
            const row = nextRows.find((r) => r.kind === "group" && r.group.id === group.id);
            return row && row.kind === "group" ? { ...group, order: row.group.order } : group;
          });
          setVaults(nextVaults);
          setGroups(nextGroups);
          const orders = nextGroups
            .filter((group) => groups.find((g) => g.id === group.id)?.order !== group.order)
            .map((group) => ({ id: group.id, order: group.order }));
          if (orders.length > 0) onRootGroupsReordered?.(orders);
        }
        setDraggingId(null);
        setDragOverId(null);
      };
    },
    [
      allowDragVaultIntoGroup,
      canReorder,
      commitAssignToGroup,
      commitUngroup,
      displayRows,
      draggingId,
      groups,
      onRootGroupsReordered,
      vaults,
    ],
  );

  const onMemberDrop = useCallback(
    (groupId: string, targetVaultId: string) => {
      return (event: React.DragEvent) => {
        if (isOsFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const group = groups.find((g) => g.id === groupId);
        if (!group) {
          setDraggingId(null);
          setDragOverId(null);
          return;
        }
        const raw = event.dataTransfer.getData(MEMBER_DRAG_MIME);
        const rootRaw = event.dataTransfer.getData(ROOT_DRAG_MIME) || draggingId;
        let draggedVaultId: string | null = null;
        let sourceGroupId: string | null = groupId;
        if (raw) {
          const [gid, vid] = raw.split("\t");
          sourceGroupId = gid;
          draggedVaultId = vid;
        } else if (draggingId?.startsWith("member:")) {
          const parts = draggingId.split(":");
          sourceGroupId = parts[1] ?? groupId;
          draggedVaultId = parts[2] ?? null;
        } else if (rootRaw?.startsWith("vault:")) {
          sourceGroupId = null;
          draggedVaultId = rootRaw.slice("vault:".length);
        }

        if (draggedVaultId && sourceGroupId === groupId && draggedVaultId !== targetVaultId) {
          if (canReorderGroupedVaults(groupedVaultSortOf(group))) {
            const nextGroup = reorderGroupedVaults(group, draggedVaultId, targetVaultId);
            setGroups((current) => current.map((g) => (g.id === groupId ? nextGroup : g)));
            onGroupedVaultsReordered?.(groupId, nextGroup.groupedVaults);
          }
        } else if (
          draggedVaultId &&
          allowDragVaultIntoGroup &&
          sourceGroupId !== groupId
        ) {
          commitAssignToGroup(draggedVaultId, groupId, targetVaultId);
        }
        setDraggingId(null);
        setDragOverId(null);
      };
    },
    [allowDragVaultIntoGroup, commitAssignToGroup, draggingId, groups, onGroupedVaultsReordered],
  );

  // Legacy vault-id drag adapters for VaultRow (root vault rows only).
  const onDragStart = useCallback(
    (vaultId: string) => {
      const row = displayRows.find((r) => r.kind === "vault" && r.vault.id === vaultId);
      if (row) return onRootDragStart(row);
      // Member rows use onMemberDragStart from VaultList.
      return onMemberDragStart("", vaultId);
    },
    [displayRows, onMemberDragStart, onRootDragStart],
  );

  const onDragOver = useCallback(
    (vaultId: string) => {
      const row = displayRows.find((r) => r.kind === "vault" && r.vault.id === vaultId);
      if (row) return onRootDragOver(row);
      return (event: React.DragEvent) => {
        event.preventDefault();
      };
    },
    [displayRows, onRootDragOver],
  );

  const onDrop = useCallback(
    (vaultId: string) => {
      const row = displayRows.find((r) => r.kind === "vault" && r.vault.id === vaultId);
      if (row) return onRootDrop(row);
      return (event: React.DragEvent) => {
        event.preventDefault();
      };
    },
    [displayRows, onRootDrop],
  );

  const updateNote = useCallback((vaultId: string, note: string) => {
    const trimmed = (note ?? "").slice(0, VAULT_NOTE_MAX_LENGTH);
    setVaults((current) =>
      current.map((vault) =>
        vault.id === vaultId && (vault.note ?? "") !== trimmed
          ? { ...vault, note: trimmed }
          : vault,
      ),
    );
  }, []);

  const removeVault = useCallback((vaultId: string) => {
    unregisterMockVaultId(vaultId);
    setVaults((current) => current.filter((vault) => vault.id !== vaultId));
    setGroups((current) =>
      current.map((group) => ({
        ...group,
        groupedVaults: group.groupedVaults.filter((id) => id !== vaultId),
      })),
    );
    setDraggingId((id) => (id?.includes(vaultId) ? null : id));
    setDragOverId((id) => (id?.includes(vaultId) ? null : id));
  }, []);

  const updateVaultSettings = useCallback((vaultId: string, patch: VaultSettingsListPatch) => {
    setVaults((current) => {
      const next = current.map((vault) =>
        vault.id === vaultId
          ? {
              ...vault,
              displayName: patch.displayName,
              order: patch.order,
              note: patch.note,
              hidden: patch.hidden,
              passwordHint: patch.passwordHint,
              storageMode: patch.storageMode,
              canSeal: patch.canSeal,
            }
          : vault,
      );
      return sortVaultsByOrder(next);
    });
  }, []);

  const addVault = useCallback((vault: VaultListItem) => {
    registerMockVaultId(vault.id);
    setVaults((current) => sortVaultsByOrder([...current, vault]));
  }, []);

  const setVaultRuntimeState = useCallback(
    (
      vaultId: string,
      patch: {
        session: VaultSession | null;
        persistence?: VaultPersistence;
        canSeal?: boolean;
        lastAccessedAt?: string;
        lastAccessedWhen?: string;
      },
    ) => {
      setVaults((current) =>
        current.map((vault) => (vault.id === vaultId ? { ...vault, ...patch } : vault)),
      );
    },
    [],
  );

  const upsertGroup = useCallback((group: VaultGroup) => {
    setGroups((current) => {
      const index = current.findIndex((g) => g.id === group.id);
      if (index < 0) return [...current, { ...group, groupedVaults: [...group.groupedVaults] }];
      return current.map((g) => (g.id === group.id ? { ...group, groupedVaults: [...group.groupedVaults] } : g));
    });
  }, []);

  const removeGroup = useCallback((groupId: string) => {
    setGroups((current) => current.filter((g) => g.id !== groupId));
  }, []);

  const setGroupCollapsed = useCallback((groupId: string, collapsed: boolean) => {
    setGroups((current) =>
      current.map((g) => (g.id === groupId ? { ...g, collapsed } : g)),
    );
  }, []);

  return {
    isReady,
    initializeVaults,
    initializeGroups,
    vaults,
    groups,
    groupsInvalid,
    groupsInvalidDismissed,
    setGroupsInvalidDismissed,
    displayRows,
    displayVaults,
    sort,
    setSort,
    viewMode,
    setViewMode,
    canReorder,
    allowDragVaultIntoGroup,
    draggingId,
    dragOverId,
    resetList,
    updateNote,
    removeVault,
    addVault,
    setVaultRuntimeState,
    updateVaultSettings,
    upsertGroup,
    removeGroup,
    setGroupCollapsed,
    setGroups,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
    onRootDragStart,
    onRootDragOver,
    onRootDrop,
    onUngroupDragOver,
    onUngroupDrop,
    onMemberDragStart,
    onMemberDragOver,
    onMemberDrop,
  };
}
