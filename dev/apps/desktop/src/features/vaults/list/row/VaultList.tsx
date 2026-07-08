import { useTranslation } from "@/i18n";
import { VaultBlockCard } from "./VaultBlockCard";
import { VaultRow } from "./VaultRow";
import type { VaultListViewMode, VaultListItem } from "@upriv/shared";

export interface VaultPipelineListStatus {
  openingVaultIds?: readonly string[];
  closingVaultIds?: readonly string[];
}

interface VaultListProps {
  vaults: VaultListItem[];
  pipelineListStatus?: VaultPipelineListStatus;
  isVaultPipelineBusy?: (vaultId: string) => boolean;
  allVaultsHidden?: boolean;
  viewMode: VaultListViewMode;
  canReorder: boolean;
  draggingId: string | null;
  dragOverId: string | null;
  onOpenBackups: (vaultId: string) => void;
  onOpenNote: (vaultId: string) => void;
  onOpenSettings: (vaultId: string) => void;
  onExportVault: (vault: VaultListItem) => void;
  onOpenFolder: (vault: VaultListItem) => void;
  onOpenFileManager: (vault: VaultListItem) => void;
  onLockVault: (vault: VaultListItem) => void;
  onUnlockVault: (vault: VaultListItem) => void;
  onSealVault: (vault: VaultListItem) => void;
  onDragStart: (vaultId: string) => (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (vaultId: string) => (event: React.DragEvent) => void;
  onDragLeave: (vaultId: string) => () => void;
  onDrop: (vaultId: string) => (event: React.DragEvent) => void;
}

export function VaultList({
  vaults,
  pipelineListStatus = {},
  isVaultPipelineBusy = () => false,
  allVaultsHidden = false,
  viewMode,
  canReorder,
  draggingId,
  dragOverId,
  onOpenBackups,
  onOpenNote,
  onOpenSettings,
  onExportVault,
  onOpenFolder,
  onOpenFileManager,
  onLockVault,
  onUnlockVault,
  onSealVault,
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
        {allVaultsHidden ? t("empty.vaults_all_hidden") : t("empty.no_vaults")}
      </p>
    );
  }

  if (viewMode === "blocks") {
    return (
      <div className="relative">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {vaults.map((vault) => (
            <VaultBlockCard
              key={vault.id}
              vault={vault}
              pipelineListStatus={pipelineListStatus}
              isPipelineBusy={isVaultPipelineBusy(vault.id)}
              onOpenBackups={onOpenBackups}
              onOpenNote={onOpenNote}
              onOpenSettings={onOpenSettings}
              onExportVault={onExportVault}
              onOpenFolder={onOpenFolder}
              onOpenFileManager={onOpenFileManager}
              onLockVault={onLockVault}
              onUnlockVault={onUnlockVault}
              onSealVault={onSealVault}
            />
          ))}
        </div>
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
      </div>
    );
  }

  const listGap =
    viewMode === "compact" ? "space-y-3" : viewMode === "large" ? "space-y-4" : "space-y-4";

  return (
    <div className={`relative overflow-visible ${listGap}`}>
      {vaults.map((vault) => (
        <VaultRow
          key={vault.id}
          vault={vault}
          pipelineListStatus={pipelineListStatus}
          viewMode={viewMode}
          dragDisabled={!canReorder}
          isDragging={draggingId === vault.id}
          isDragOver={dragOverId === vault.id && draggingId !== vault.id}
          isReorderActive={draggingId !== null}
          isPipelineBusy={isVaultPipelineBusy(vault.id)}
          onOpenBackups={onOpenBackups}
          onOpenNote={onOpenNote}
          onOpenSettings={onOpenSettings}
          onExportVault={onExportVault}
          onOpenFolder={onOpenFolder}
          onOpenFileManager={onOpenFileManager}
          onLockVault={onLockVault}
          onUnlockVault={onUnlockVault}
          onSealVault={onSealVault}
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
