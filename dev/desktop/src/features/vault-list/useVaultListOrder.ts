import { useCallback, useState } from "react";
import { VAULT_NOTE_MAX_LENGTH } from "@/constants/vault";
import type { VaultListItem } from "./types";
import { reorderVaultList, sortVaultsByOrder } from "./vaultOrder";

const DRAG_MIME = "application/x-upriv-vault-id";

export function useVaultListOrder(initialVaults: VaultListItem[]) {
  const [vaults, setVaults] = useState(() => sortVaultsByOrder(initialVaults));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const resetOrder = useCallback(() => {
    setVaults(sortVaultsByOrder(initialVaults));
    setDraggingId(null);
    setDragOverId(null);
  }, [initialVaults]);

  const onDragStart = useCallback((vaultId: string) => {
    return (event: React.DragEvent) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(DRAG_MIME, vaultId);
      setDraggingId(vaultId);
    };
  }, []);

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  const onDragOver = useCallback((vaultId: string) => {
    return (event: React.DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDragOverId(vaultId);
    };
  }, []);

  const onDragLeave = useCallback((vaultId: string) => {
    return () => {
      setDragOverId((current) => (current === vaultId ? null : current));
    };
  }, []);

  const onDrop = useCallback((targetId: string) => {
    return (event: React.DragEvent) => {
      event.preventDefault();
      const draggedId = event.dataTransfer.getData(DRAG_MIME) || draggingId;
      if (draggedId && draggedId !== targetId) {
        setVaults((current) => reorderVaultList(current, draggedId, targetId));
      }
      setDraggingId(null);
      setDragOverId(null);
    };
  }, [draggingId]);

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
    draggingId,
    dragOverId,
    resetOrder,
    updateNote,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
