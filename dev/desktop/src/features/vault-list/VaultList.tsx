import { useTranslation } from "@/i18n";
import { VaultRow } from "./VaultRow";
import type { VaultListItem } from "./types";

interface VaultListProps {
  vaults: VaultListItem[];
  draggingId: string | null;
  dragOverId: string | null;
  onOpenNote: (vaultId: string) => void;
  onDragStart: (vaultId: string) => (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (vaultId: string) => (event: React.DragEvent) => void;
  onDragLeave: (vaultId: string) => () => void;
  onDrop: (vaultId: string) => (event: React.DragEvent) => void;
}

export function VaultList({
  vaults,
  draggingId,
  dragOverId,
  onOpenNote,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: VaultListProps) {
  const { t } = useTranslation();

  if (vaults.length === 0) {
    return (
      <p className="py-16 text-center font-mono text-sm uppercase tracking-widest text-on-surface-variant">
        {t("empty.no_vaults")}
      </p>
    );
  }

  return (
    <div className="relative space-y-4 overflow-visible">
      {vaults.map((vault) => (
        <VaultRow
          key={vault.id}
          vault={vault}
          isDragging={draggingId === vault.id}
          isDragOver={dragOverId === vault.id && draggingId !== vault.id}
          onOpenNote={onOpenNote}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        />
      ))}
      <div className="pointer-events-none fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}
