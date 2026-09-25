import { useCallback, useMemo, useRef, useState } from "react";
import {
  VAULT_NOTE_MAX_LENGTH,
  DEFAULT_VAULT_LIST_VIEW,
  type VaultListViewMode,
  type VaultSession,
  type VaultSettingsListPatch,
  type VaultListItem,
  type VaultGroup,
  type VaultListRootRow,
  applyVaultListHierarchySort,
  applyVaultSettingsListPatch,
  remapVaultIdInGroups,
  mergeVaultListSnapshot,
  canReorderGroupedVaults,
  canReorderVaultList,
  DEFAULT_VAULT_LIST_SORT,
  type VaultListSort,
  dragKeyRefersToVaultId,
  groupedVaultDropInsertsAfter,
  groupedVaultSortOf,
  hiddenUngroupedRootVaults,
  hiddenOmittedRootGroups,
  normalizeVaultGroup,
  reorderRootRows,
  reorderGroupedVaults,
  assignVaultToGroup,
  removeVaultFromGroups,
  insertUngroupedVaultAtRoot,
  resolveListDrop,
  resolveVaultPasswordHint,
  sortVaultsByOrder,
} from "@upriv/shared";
import { hitVaultListDropKey } from "../lib/hitListDropKey";

function seedVaultPasswordHints(vaults: VaultListItem[]): VaultListItem[] {
  return vaults.map((vault) => {
    const passwordHint = resolveVaultPasswordHint(vault);
    return passwordHint ? { ...vault, passwordHint } : vault;
  });
}

export function useVaultListState(
  initialVaults: VaultListItem[],
  options?: {
    initialSort?: VaultListSort;
    initialViewMode?: VaultListViewMode;
    showHiddenVaults?: boolean;
    /** Search is open — hide grips and ignore reorder/assign drops. */
    searchActive?: boolean;
    initialGroups?: VaultGroup[];
    /** Persist in-group vault order after drag (mock/RPC). Required so collapse reload keeps order. */
    onGroupedVaultsReordered?: (groupId: string, groupedVaults: string[]) => void;
    /** Persist group `order` after a root-row drop (one RPC). */
    onRootGroupsReordered?: (orders: { id: string; order: number }[]) => void;
    /** Persist ungrouped vault `order` after a root-row drop (`config.toml` / mock settings). */
    onRootVaultsReordered?: (orders: { id: string; order: number }[]) => void;
    /** Drop tried to reorder while sort is not `order`, or while search is active (toast). */
    onReorderBlocked?: (scope: "root" | "group" | "search") => void;
    /** Show drag handles and allow list/group reorder. Default true. */
    vaultListShowDrag?: boolean;
    /** Drop a vault onto a group (ungrouped or cross-group). Default true. */
    vaultListAllowDragIntoGroup?: boolean;
    onVaultAssignedToGroup?: (targetGroupId: string, groupedVaults: string[]) => void;
  },
) {
  const onGroupedVaultsReordered = options?.onGroupedVaultsReordered;
  const onRootGroupsReordered = options?.onRootGroupsReordered;
  const onRootVaultsReordered = options?.onRootVaultsReordered;
  const onReorderBlocked = options?.onReorderBlocked;
  const searchLocked = options?.searchActive === true;
  const vaultListShowDrag = options?.vaultListShowDrag !== false && !searchLocked;
  const vaultListAllowDragIntoGroup =
    options?.vaultListAllowDragIntoGroup !== false && !searchLocked;
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
  const draggingIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragOverIdRef = useRef<string | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  const sessionWritesRef = useRef(new Map<string, number>());

  const beginDrag = useCallback((key: string) => {
    draggingIdRef.current = key;
    setDraggingId(key);
  }, []);

  const endDrag = useCallback(() => {
    draggingIdRef.current = null;
    dragOverIdRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
    setDragPointer(null);
  }, []);

  const showHiddenVaults = options?.showHiddenVaults ?? false;

  const displayRows = useMemo(() => {
    return applyVaultListHierarchySort(vaults, groups, sort, { showHiddenVaults });
  }, [vaults, groups, sort, showHiddenVaults]);

  const canReorder = vaultListShowDrag && canReorderVaultList(sort);

  const persistRootOrdersFromRows = useCallback(
    (nextRows: VaultListRootRow[]) => {
      const nextVaults = vaults.map((vault) => {
        const row = nextRows.find((r) => r.kind === "vault" && r.vault.id === vault.id);
        return row && row.kind === "vault" ? { ...vault, order: row.vault.order } : vault;
      });
      const nextGroups = groups.map((group) => {
        const row = nextRows.find((r) => r.kind === "group" && r.group.id === group.id);
        return row && row.kind === "group" ? { ...group, order: row.group.order } : group;
      });
      setVaults(nextVaults);
      const groupOrders = nextGroups
        .filter((group) => groups.find((g) => g.id === group.id)?.order !== group.order)
        .map((group) => ({ id: group.id, order: group.order }));
      if (groupOrders.length > 0) onRootGroupsReordered?.(groupOrders);
      const vaultOrders = nextVaults
        .filter((vault) => vaults.find((item) => item.id === vault.id)?.order !== vault.order)
        .map((vault) => ({ id: vault.id, order: vault.order ?? 0 }));
      if (vaultOrders.length > 0) onRootVaultsReordered?.(vaultOrders);
      return nextGroups;
    },
    [groups, onRootGroupsReordered, onRootVaultsReordered, vaults],
  );

  const resetSessionWrites = useCallback(() => {
    sessionWritesRef.current.clear();
  }, []);

  const initializeVaults = useCallback(
    (rows: VaultListItem[], fetchStartedAt: number) => {
      setVaults((current) =>
        sortVaultsByOrder(
          seedVaultPasswordHints(
            mergeVaultListSnapshot(current, rows, sessionWritesRef.current, fetchStartedAt),
          ),
        ),
      );
      setIsReady(true);
      endDrag();
    },
    [endDrag],
  );

  const initializeGroups = useCallback((next: VaultGroup[], invalid = false) => {
    setGroups(next.map((g) => normalizeVaultGroup({ ...g, groupedVaults: [...g.groupedVaults] })));
    setGroupsInvalid(invalid);
    if (!invalid) setGroupsInvalidDismissed(false);
  }, []);

  const commitAssignToGroup = useCallback(
    (vaultId: string, targetGroupId: string, beforeVaultId?: string | null) => {
      const source = groups.find((g) => g.groupedVaults.includes(vaultId));
      if (source?.id === targetGroupId && !beforeVaultId) return;
      const targetGroup = groups.find((g) => g.id === targetGroupId);
      const nextGroups = assignVaultToGroup(groups, vaultId, targetGroupId, beforeVaultId, {
        insertAfter: targetGroup ? groupedVaultDropInsertsAfter(targetGroup) : false,
      });
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
          const hiddenTail = hiddenUngroupedRootVaults(vaults, groups, displayRows);
          const hiddenGroups = hiddenOmittedRootGroups(groups, displayRows);
          const nextRows = insertUngroupedVaultAtRoot(
            displayRows,
            vault,
            beforeVaultId,
            sort.direction,
            hiddenTail,
            hiddenGroups,
          );
          nextVaults = vaults.map((item) => {
            const row = nextRows.find((r) => r.kind === "vault" && r.vault.id === item.id);
            return row && row.kind === "vault" ? { ...item, order: row.vault.order } : item;
          });
          nextGroups = nextGroups.map((group) => {
            const row = nextRows.find((r) => r.kind === "group" && r.group.id === group.id);
            return row && row.kind === "group" ? { ...group, order: row.group.order } : group;
          });
          const groupOrders = nextGroups
            .filter((group) => groups.find((g) => g.id === group.id)?.order !== group.order)
            .map((group) => ({ id: group.id, order: group.order }));
          if (groupOrders.length > 0) onRootGroupsReordered?.(groupOrders);
          const vaultOrders = nextVaults
            .filter((item) => vaults.find((prev) => prev.id === item.id)?.order !== item.order)
            .map((item) => ({ id: item.id, order: item.order ?? 0 }));
          if (vaultOrders.length > 0) onRootVaultsReordered?.(vaultOrders);
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
      onRootVaultsReordered,
      onVaultAssignedToGroup,
      sort.direction,
      vaults,
    ],
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
    sessionWritesRef.current.delete(vaultId);
    setVaults((current) => current.filter((vault) => vault.id !== vaultId));
    setGroups((current) =>
      current.map((group) => ({
        ...group,
        groupedVaults: group.groupedVaults.filter((id) => id !== vaultId),
      })),
    );
    setDraggingId((id) => {
      if (dragKeyRefersToVaultId(id, vaultId)) {
        draggingIdRef.current = null;
        return null;
      }
      return id;
    });
    setDragOverId((id) => (dragKeyRefersToVaultId(id, vaultId) ? null : id));
  }, []);

  const updateVaultSettings = useCallback((vaultId: string, patch: VaultSettingsListPatch) => {
    const nextId = patch.id || vaultId;
    setVaults((current) => {
      const next = current.map((vault) =>
        vault.id === vaultId ? applyVaultSettingsListPatch(vault, patch) : vault,
      );
      return sortVaultsByOrder(next);
    });
    if (nextId !== vaultId) {
      setGroups((current) => remapVaultIdInGroups(current, vaultId, nextId));
      const writtenAt = sessionWritesRef.current.get(vaultId);
      if (writtenAt !== undefined) {
        sessionWritesRef.current.delete(vaultId);
        sessionWritesRef.current.set(nextId, writtenAt);
      }
    }
  }, []);

  const markVaultsHidden = useCallback((vaultIds: readonly string[], hidden = true) => {
    if (vaultIds.length === 0) return;
    const idSet = new Set(vaultIds);
    setVaults((current) => {
      let changed = false;
      const next = current.map((vault) => {
        if (!idSet.has(vault.id) || vault.hidden === hidden) return vault;
        changed = true;
        return { ...vault, hidden };
      });
      return changed ? next : current;
    });
  }, []);

  const touchSessionWrite = useCallback((vaultId: string) => {
    sessionWritesRef.current.set(vaultId, Date.now());
  }, []);

  const addVault = useCallback((vault: VaultListItem) => {
    sessionWritesRef.current.set(vault.id, Date.now());
    setVaults((current) => sortVaultsByOrder([...current, vault]));
  }, []);

  const setVaultRuntimeState = useCallback(
    (
      vaultId: string,
      patch: {
        session: VaultSession | null;
        lastAccessedAt?: string;
        lastAccessedWhen?: string;
      },
    ) => {
      sessionWritesRef.current.set(vaultId, Date.now());
      setVaults((current) =>
        current.map((vault) => (vault.id === vaultId ? { ...vault, ...patch } : vault)),
      );
    },
    [],
  );

  const setGroupCollapsed = useCallback((groupId: string, collapsed: boolean) => {
    setGroups((current) => current.map((g) => (g.id === groupId ? { ...g, collapsed } : g)));
  }, []);

  const applyListDrop = useCallback(
    (sourceKey: string, targetKey: string | null) => {
      const action = resolveListDrop({
        sourceKey,
        targetKey,
        canReorderRoot: canReorder,
        allowDragIntoGroup: vaultListAllowDragIntoGroup,
        canReorderGrouped: (groupId) => {
          const group = groups.find((g) => g.id === groupId);
          return Boolean(
            group && vaultListShowDrag && canReorderGroupedVaults(groupedVaultSortOf(group)),
          );
        },
      });

      if (action.kind === "reorder-grouped") {
        const group = groups.find((g) => g.id === action.groupId);
        if (group) {
          const nextGroup = reorderGroupedVaults(
            group,
            action.draggedVaultId,
            action.targetVaultId,
          );
          setGroups((current) => current.map((g) => (g.id === group.id ? nextGroup : g)));
          onGroupedVaultsReordered?.(group.id, nextGroup.groupedVaults);
        }
        endDrag();
        return;
      }

      if (action.kind === "ungroup") {
        commitUngroup(action.vaultId, action.beforeVaultId);
        endDrag();
        return;
      }

      if (action.kind === "assign-to-group") {
        commitAssignToGroup(action.vaultId, action.targetGroupId, action.beforeVaultId);
        endDrag();
        return;
      }

      if (action.kind === "reorder-root") {
        const hiddenTail = hiddenUngroupedRootVaults(vaults, groups, displayRows);
        const hiddenGroups = hiddenOmittedRootGroups(groups, displayRows);
        const nextRows = persistRootOrdersFromRows(
          reorderRootRows(
            displayRows,
            sourceKey,
            targetKey!,
            sort.direction,
            hiddenTail,
            hiddenGroups,
          ),
        );
        setGroups(nextRows);
        endDrag();
        return;
      }

      if (action.kind === "blocked-reorder-root") {
        onReorderBlocked?.(searchLocked ? "search" : "root");
      } else if (action.kind === "blocked-reorder-grouped") {
        onReorderBlocked?.(searchLocked ? "search" : "group");
      }

      endDrag();
    },
    [
      vaultListAllowDragIntoGroup,
      canReorder,
      commitAssignToGroup,
      commitUngroup,
      displayRows,
      endDrag,
      groups,
      onGroupedVaultsReordered,
      onReorderBlocked,
      persistRootOrdersFromRows,
      searchLocked,
      sort.direction,
      vaultListShowDrag,
      vaults,
    ],
  );

  const onPointerDragStart = useCallback(
    (key: string, clientX: number, clientY: number) => {
      dragOverIdRef.current = null;
      beginDrag(key);
      setDragOverId(null);
      setDragPointer({ x: clientX, y: clientY });
    },
    [beginDrag],
  );

  const onPointerDragMove = useCallback((clientX: number, clientY: number) => {
    setDragPointer({ x: clientX, y: clientY });
    const over = hitVaultListDropKey(clientX, clientY, draggingIdRef.current);
    dragOverIdRef.current = over;
    setDragOverId(over);
  }, []);

  const onPointerDragEnd = useCallback(
    (clientX: number, clientY: number) => {
      const source = draggingIdRef.current;
      if (!source) {
        endDrag();
        return;
      }
      const over = dragOverIdRef.current ?? hitVaultListDropKey(clientX, clientY, source);
      applyListDrop(source, over);
    },
    [applyListDrop, endDrag],
  );

  const onPointerDragCancel = useCallback(() => {
    endDrag();
  }, [endDrag]);

  return {
    isReady,
    initializeVaults,
    resetSessionWrites,
    initializeGroups,
    vaults,
    groups,
    groupsInvalid,
    groupsInvalidDismissed,
    setGroupsInvalidDismissed,
    displayRows,
    sort,
    setSort,
    viewMode,
    setViewMode,
    canReorder,
    vaultListShowDrag,
    vaultListAllowDragIntoGroup,
    draggingId,
    dragOverId,
    dragPointer,
    updateNote,
    removeVault,
    addVault,
    touchSessionWrite,
    setVaultRuntimeState,
    updateVaultSettings,
    markVaultsHidden,
    setGroupCollapsed,
    setGroups,
    onPointerDragStart,
    onPointerDragMove,
    onPointerDragEnd,
    onPointerDragCancel,
  };
}
