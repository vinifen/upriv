import { AppSettingsModal } from "@/features/system/settings";
import { VaultBackupsModal } from "@/features/vaults/backups";
import { CreateVaultWizardModal } from "@/features/vaults/create";
import { FileManagerLayer } from "@/features/vaults/file-manager";
import { HelpModal } from "@/features/system/help";
import { LogsModal } from "@/features/system/logs";
import { VaultLifecycleLayer } from "@/features/vaults/lifecycle";
import { VaultSettingsModal } from "@/features/vaults/settings";
import { AppShell } from "@/components/layout";
import { Toast } from "@/components/ui";
import { VaultList } from "./VaultList";
import { VaultListHeader } from "./VaultListHeader";
import { VaultListSectionHeader } from "./VaultListSectionHeader";
import { VaultNoteModal } from "./VaultNoteModal";
import { useVaultListScreen } from "./hooks/useVaultListScreen";

export function VaultListPage() {
  const screen = useVaultListScreen();

  if (!screen.isReady) {
    return <div className="min-h-screen bg-background" aria-busy="true" />;
  }

  const {
    header,
    list,
    lifecycle,
    toast,
    note,
    backups,
    settings,
    appSettings,
    logs,
    help,
    createVault,
  } = screen;

  return (
    <AppShell header={<VaultListHeader {...header} />} contentClassName="max-w-vault-list">
      <VaultListSectionHeader
        sort={list.sort}
        onSortChange={list.onSortChange}
        viewMode={list.viewMode}
        onViewModeChange={list.onViewModeChange}
      />
      <VaultList
        vaults={list.displayVaults}
        pipelineOpeningVaultId={list.pipelineOpeningVaultId}
        pipelineActiveVaultId={list.pipelineActiveVaultId}
        allVaultsHidden={list.allVaultsHidden}
        viewMode={list.viewMode}
        canReorder={list.canReorder}
        draggingId={list.draggingId}
        dragOverId={list.dragOverId}
        onOpenBackups={list.onOpenBackups}
        onOpenNote={list.onOpenNote}
        onOpenSettings={list.onOpenSettings}
        onExportVault={list.onExportVault}
        onOpenFolder={list.onOpenFolder}
        onOpenFileManager={screen.openFromVault}
        onLockVault={list.onLockVault}
        onUnlockVault={list.onUnlockVault}
        onSealVault={list.onSealVault}
        onDragStart={list.onDragStart}
        onDragEnd={list.onDragEnd}
        onDragOver={list.onDragOver}
        onDragLeave={list.onDragLeave}
        onDrop={list.onDrop}
      />
      <VaultLifecycleLayer {...lifecycle} />
      <Toast message={toast.message} onDismiss={toast.onDismiss} />
      <VaultNoteModal
        vault={note.vault}
        open={note.open}
        onClose={note.onClose}
        onNoteChange={note.onNoteChange}
      />
      <VaultBackupsModal
        vault={backups.vault}
        open={backups.open}
        onClose={backups.onClose}
        onCreateVaultFromBackup={backups.onCreateVaultFromBackup}
      />
      <VaultSettingsModal
        vault={settings.vault}
        open={settings.open}
        onClose={settings.onClose}
        onVaultSettingsSaved={settings.onVaultSettingsSaved}
        onVaultDelete={settings.onVaultDelete}
      />
      <FileManagerLayer />
      <AppSettingsModal
        open={appSettings.open}
        vaults={appSettings.vaults}
        onClose={appSettings.onClose}
      />
      <LogsModal open={logs.open} onClose={logs.onClose} />
      <HelpModal open={help.open} onClose={help.onClose} />
      <CreateVaultWizardModal
        open={createVault.open}
        existingVaultIds={createVault.existingVaultIds}
        existingOrders={createVault.existingOrders}
        initialDraft={createVault.initialDraft}
        onClose={createVault.onClose}
        onCreate={createVault.onCreate}
      />
    </AppShell>
  );
}
