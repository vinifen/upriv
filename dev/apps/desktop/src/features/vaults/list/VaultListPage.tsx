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
import { useTranslation } from "@/i18n";
import { VaultListHeader } from "./header/VaultListHeader";
import { VaultListSectionHeader } from "./header/VaultListSectionHeader";
import { VaultNoteModal } from "./modals/VaultNoteModal";
import { VaultList } from "./row/VaultList";
import { useVaultListScreen } from "./hooks/useVaultListScreen";

export function VaultListPage() {
  const screen = useVaultListScreen();
  const { t } = useTranslation();

  if (!screen.isReady) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background font-mono text-sm text-on-surface-variant"
        aria-busy="true"
      >
        {t("vault.list.loading")}
      </div>
    );
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
    archiveDrop,
  } = screen;

  return (
    <AppShell header={<VaultListHeader {...header} />} contentClassName="max-w-vault-list">
      <div
        className="relative min-h-[min(28rem,70vh)]"
        onDragEnter={archiveDrop.onDragEnter}
        onDragOver={archiveDrop.onDragOver}
        onDragLeave={archiveDrop.onDragLeave}
        onDrop={archiveDrop.onDrop}
      >
        <VaultListSectionHeader
          sort={list.sort}
          onSortChange={list.onSortChange}
          viewMode={list.viewMode}
          onViewModeChange={list.onViewModeChange}
        />
        <VaultList
          vaults={list.displayVaults}
          pipelineListStatus={list.pipelineListStatus}
          isVaultPipelineBusy={list.isVaultPipelineBusy}
          allVaultsHidden={list.allVaultsHidden}
          viewMode={list.viewMode}
          canReorder={list.canReorder}
          draggingId={list.draggingId}
          dragOverId={list.dragOverId}
          onCreateFromScratch={list.onCreateFromScratch}
          onImportArchive={list.onImportArchive}
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
        {archiveDrop.isArchiveDropActive ? (
          <div
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/10 backdrop-blur-[1px]"
            aria-hidden
          >
            <p className="px-4 text-center font-mono text-sm uppercase tracking-widest text-primary">
              {t("empty.drop_archive_overlay")}
            </p>
          </div>
        ) : null}
      </div>
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
        initialStep={createVault.initialStep}
        onClose={createVault.onClose}
        onCreate={createVault.onCreate}
      />
    </AppShell>
  );
}
