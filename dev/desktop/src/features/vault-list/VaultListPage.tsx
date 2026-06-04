import { useCallback, useMemo, useState } from "react";
import { MOCK_VAULTS } from "./mockVaults";
import { VaultList } from "./VaultList";
import { VaultListHeader, useRefreshState } from "./VaultListHeader";
import { VaultListSectionHeader } from "./VaultListSectionHeader";
import { VaultBackupsModal } from "./VaultBackupsModal";
import { VaultNoteModal } from "./VaultNoteModal";
import { useVaultListState } from "./useVaultListState";

export function VaultListPage() {
  const { isRefreshing, refresh: runRefreshAnimation } = useRefreshState();
  const [noteVaultId, setNoteVaultId] = useState<string | null>(null);
  const [backupVaultId, setBackupVaultId] = useState<string | null>(null);

  const {
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
  } = useVaultListState(MOCK_VAULTS);

  const noteVault = useMemo(
    () => vaults.find((vault) => vault.id === noteVaultId) ?? null,
    [vaults, noteVaultId],
  );

  const backupVault = useMemo(
    () => vaults.find((vault) => vault.id === backupVaultId) ?? null,
    [vaults, backupVaultId],
  );

  const handleRefresh = useCallback(() => {
    resetList();
    runRefreshAnimation();
  }, [resetList, runRefreshAnimation]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-on-surface">
      <VaultListHeader onRefresh={handleRefresh} isRefreshing={isRefreshing} />
      <main className="flex flex-1 flex-col items-center py-10 md:py-12">
        <section className="w-full max-w-vault-list px-margin-mobile md:px-margin-desktop">
          <VaultListSectionHeader
            sort={sort}
            onSortChange={setSort}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
          <VaultList
            vaults={displayVaults}
            viewMode={viewMode}
            canReorder={canReorder}
            draggingId={draggingId}
            dragOverId={dragOverId}
            onOpenBackups={setBackupVaultId}
            onOpenNote={setNoteVaultId}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          />
        </section>
      </main>
      <VaultNoteModal
        vault={noteVault}
        open={noteVaultId !== null}
        onClose={() => setNoteVaultId(null)}
        onNoteChange={updateNote}
      />
      <VaultBackupsModal
        vault={backupVault}
        open={backupVaultId !== null}
        onClose={() => setBackupVaultId(null)}
      />
    </div>
  );
}
