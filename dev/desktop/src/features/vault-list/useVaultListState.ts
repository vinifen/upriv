import { useCallback, useMemo, useState } from "react";
import { VAULT_NOTE_MAX_LENGTH } from "@/constants/vault";
import {
  applyVaultListSort,
  canReorderVaultList,
  DEFAULT_VAULT_LIST_SORT,
  type VaultListSort,
} from "./vaultListSort";
import { DEFAULT_VAULT_LIST_VIEW, type VaultListViewMode } from "./vaultListView";
import type { VaultListItem } from "./types";
import { reorderVaultList, sortVaultsByOrder } from "./vaultOrder";

const DRAG_MIME = "application/x-upriv-vault-id";

export function useVaultListState(initialVaults: VaultListItem[]) {
  const [vaults, setVaults] = useState(() => sortVaultsByOrder(initialVaults));
  const [sort, setSort] = useState<VaultListSort>(DEFAULT_VAULT_LIST_SORT);
  const [viewMode, setViewMode] = useState<VaultListViewMode>(DEFAULT_VAULT_LIST_VIEW);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const displayVaults = useMemo(() => applyVaultListSort(vaults, sort), [vaults, sort]);
  const canReorder = canReorderVaultList(sort);

  const resetList = useCallback(() => {
    setVaults(sortVaultsByOrder(initialVaults));
    setDraggingId(null);
    setDragOverId(null);
  }, [initialVaults]);

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

  return {
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
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
