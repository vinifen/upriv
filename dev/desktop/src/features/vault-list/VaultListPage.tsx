import { useCallback, useMemo, useState } from "react";
import { AppSettingsModal, useAppSettingsContext } from "@/features/app-settings";
import { HelpModal } from "@/features/help";
import { LogsModal } from "@/features/logs";
import { MOCK_VAULTS } from "./mockVaults";
import { VaultList } from "./VaultList";
import { VaultListHeader, useRefreshState } from "./VaultListHeader";
import { VaultListSectionHeader } from "./VaultListSectionHeader";
import { VaultBackupsModal } from "./VaultBackupsModal";
import { VaultNoteModal } from "./VaultNoteModal";
import { VaultSettingsModal } from "./VaultSettingsModal";
import type { VaultListSort } from "./vaultListSort";
import type { VaultListViewMode } from "./vaultListView";
import { useVaultListState } from "./useVaultListState";

export function VaultListPage() {
  const { settings, patchSettings } = useAppSettingsContext();
  const { isRefreshing, refresh: runRefreshAnimation } = useRefreshState();
  const [noteVaultId, setNoteVaultId] = useState<string | null>(null);
  const [backupVaultId, setBackupVaultId] = useState<string | null>(null);
  const [settingsVaultId, setSettingsVaultId] = useState<string | null>(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const listDefaults = useMemo(
    () => ({
      initialSort: {
        mode: settings.ui.vault_list_sort,
        direction: settings.ui.vault_list_sort_direction,
      },
      initialViewMode: settings.ui.vault_list_view,
    }),
    [settings.ui.vault_list_sort, settings.ui.vault_list_sort_direction, settings.ui.vault_list_view],
  );

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
    removeVault,
    updateVaultSettings,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  } = useVaultListState(MOCK_VAULTS, listDefaults);

  const handleSortChange = useCallback(
    (next: VaultListSort) => {
      setSort(next);
      patchSettings({
        ui: {
          vault_list_sort: next.mode,
          vault_list_sort_direction: next.direction,
        },
      });
    },
    [patchSettings, setSort],
  );

  const handleViewModeChange = useCallback(
    (next: VaultListViewMode) => {
      setViewMode(next);
      patchSettings({ ui: { vault_list_view: next } });
    },
    [patchSettings, setViewMode],
  );

  const noteVault = useMemo(
    () => vaults.find((vault) => vault.id === noteVaultId) ?? null,
    [vaults, noteVaultId],
  );

  const backupVault = useMemo(
    () => vaults.find((vault) => vault.id === backupVaultId) ?? null,
    [vaults, backupVaultId],
  );

  const settingsVault = useMemo(
    () => vaults.find((vault) => vault.id === settingsVaultId) ?? null,
    [vaults, settingsVaultId],
  );

  const handleRefresh = useCallback(() => {
    resetList();
    runRefreshAnimation();
  }, [resetList, runRefreshAnimation]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-on-surface">
      <VaultListHeader
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        onOpenSystemSettings={() => setAppSettingsOpen(true)}
        onViewLogs={() => setLogsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />
      <main className="flex flex-1 flex-col items-center py-10 md:py-12">
        <section className="w-full max-w-vault-list px-margin-mobile md:px-margin-desktop">
          <VaultListSectionHeader
            sort={sort}
            onSortChange={handleSortChange}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
          />
          <VaultList
            vaults={displayVaults}
            viewMode={viewMode}
            canReorder={canReorder}
            draggingId={draggingId}
            dragOverId={dragOverId}
            onOpenBackups={setBackupVaultId}
            onOpenNote={setNoteVaultId}
            onOpenSettings={setSettingsVaultId}
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
      <VaultSettingsModal
        vault={settingsVault}
        open={settingsVaultId !== null}
        onClose={() => setSettingsVaultId(null)}
        onVaultSettingsSaved={updateVaultSettings}
        onVaultDelete={removeVault}
      />
      <AppSettingsModal open={appSettingsOpen} onClose={() => setAppSettingsOpen(false)} />
      <LogsModal open={logsOpen} onClose={() => setLogsOpen(false)} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
