import { useCallback, useMemo, useState } from "react";
import { VAULT_NOTE_MAX_LENGTH, DEFAULT_VAULT_LIST_VIEW, type VaultListViewMode, assertPlainVaultInvariant, type VaultPersistence, type VaultSession, type VaultSettingsListPatch, type VaultListItem, reorderVaultList, sortVaultsByOrder, resolveVaultPasswordHint } from "@upriv/shared";
import {
  applyVaultListSort,
  canReorderVaultList,
  DEFAULT_VAULT_LIST_SORT,
  type VaultListSort,
} from "@upriv/shared";

function seedVaultPasswordHints(vaults: VaultListItem[]): VaultListItem[] {
  return vaults.map((vault) => {
    assertPlainVaultInvariant(vault);
    const passwordHint = resolveVaultPasswordHint(vault);
    return passwordHint ? { ...vault, passwordHint } : vault;
  });
}

const DRAG_MIME = "application/x-upriv-vault-id";

export function useVaultListState(
  initialVaults: VaultListItem[],
  options?: {
    initialSort?: VaultListSort;
    initialViewMode?: VaultListViewMode;
    showHiddenVaults?: boolean;
    reloadVaults?: () => Promise<VaultListItem[]>;
  },
) {
  const reloadVaults = options?.reloadVaults;
  const [isReady, setIsReady] = useState(initialVaults.length > 0);
  const [vaults, setVaults] = useState(() =>
    sortVaultsByOrder(seedVaultPasswordHints(initialVaults)),
  );
  const [sort, setSort] = useState<VaultListSort>(options?.initialSort ?? DEFAULT_VAULT_LIST_SORT);
  const [viewMode, setViewMode] = useState<VaultListViewMode>(
    options?.initialViewMode ?? DEFAULT_VAULT_LIST_VIEW,
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const showHiddenVaults = options?.showHiddenVaults ?? false;
  const displayVaults = useMemo(() => {
    const visible = vaults.filter((vault) => !vault.hidden || showHiddenVaults);
    return applyVaultListSort(visible, sort);
  }, [vaults, sort, showHiddenVaults]);
  const canReorder = canReorderVaultList(sort);

  const initializeVaults = useCallback((rows: VaultListItem[]) => {
    setVaults(sortVaultsByOrder(seedVaultPasswordHints(rows)));
    setIsReady(true);
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  const resetList = useCallback(async () => {
    if (reloadVaults) {
      const rows = await reloadVaults();
      initializeVaults(rows);
      return;
    }
    initializeVaults(initialVaults);
  }, [initialVaults, reloadVaults, initializeVaults]);

  const onDragStart = useCallback(
    (vaultId: string) => {
      return (event: React.DragEvent) => {
        if (!canReorder) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(DRAG_MIME, vaultId);
        setDraggingId(vaultId);
      };
    },
    [canReorder],
  );

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  const onDragOver = useCallback(
    (vaultId: string) => {
      return (event: React.DragEvent) => {
        if (!canReorder) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOverId(vaultId);
      };
    },
    [canReorder],
  );

  const onDragLeave = useCallback((vaultId: string) => {
    return () => {
      setDragOverId((current) => (current === vaultId ? null : current));
    };
  }, []);

  const onDrop = useCallback(
    (targetId: string) => {
      return (event: React.DragEvent) => {
        if (!canReorder) return;
        event.preventDefault();
        const draggedId = event.dataTransfer.getData(DRAG_MIME) || draggingId;
        if (draggedId && draggedId !== targetId) {
          setVaults((current) => reorderVaultList(current, draggedId, targetId));
        }
        setDraggingId(null);
        setDragOverId(null);
      };
    },
    [canReorder, draggingId],
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
    setVaults((current) => current.filter((vault) => vault.id !== vaultId));
    setDraggingId((id) => (id === vaultId ? null : id));
    setDragOverId((id) => (id === vaultId ? null : id));
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

  return {
    isReady,
    initializeVaults,
    vaults,
    displayVaults,
    sort,
    setSort,
    viewMode,
    setViewMode,
    canReorder,
    draggingId,
    dragOverId,
    resetList,
    updateNote,
    removeVault,
    addVault,
    setVaultRuntimeState,
    updateVaultSettings,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
