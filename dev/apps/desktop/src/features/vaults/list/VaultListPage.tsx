import { AppSettingsModal, VaultRootDataFolderModal } from "@/features/system/settings";
import { VaultBackupsModal } from "@/features/vaults/backups";
import { CreateVaultModal } from "@/features/vaults/create";
import { FileManagerLayer } from "@/features/vaults/file-manager";
import { HelpModal } from "@/features/system/help";
import { SystemInfoModal } from "@/features/system/info";
import { LogsModal } from "@/features/system/logs";
import { VaultInfoModal } from "@/features/vaults/info";
import { VaultLifecycleLayer } from "@/features/vaults/lifecycle";
import { VaultSettingsModal } from "@/features/vaults/settings";
import { AppShell } from "@/components/layout";
import { Button, Toast } from "@/components/ui";
import { appConfigEditAllowed } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { VaultListHeader } from "./header/VaultListHeader";
import { VaultListSectionHeader } from "./header/VaultListSectionHeader";
import { VaultGroupSettingsModal } from "./modals/VaultGroupSettingsModal";
import { VaultGroupsModal } from "./modals/VaultGroupsModal";
import { VaultNoteModal } from "./modals/VaultNoteModal";
import { ExportVaultModal } from "./modals/ExportVaultModal";
import { VaultGroupsInvalidBanner } from "./VaultGroupsInvalidBanner";
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
    groupSettings,
    appSettings,
    groupsModal,
    dataFolder,
    logs,
    help,
    systemInfo,
    vaultInfo,
    createVault,
    importDrop,
    exportVault,
  } = screen;

  return (
    <AppShell header={<VaultListHeader {...header} />} contentClassName="max-w-vault-list">
      <div
        className="relative min-h-[min(28rem,70vh)]"
        onDragEnter={importDrop.onDragEnter}
        onDragOver={importDrop.onDragOver}
        onDragLeave={importDrop.onDragLeave}
        onDrop={importDrop.onDrop}
      >
        {list.groupsSanitizeNotice ? (
          <div
            className="mb-4 flex flex-col gap-3 rounded-xl border border-outline-variant/50 bg-surface-container px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            role="status"
          >
            <p className="text-sm text-on-surface-variant">
              {t("vault.group.sanitize_notice", {
                orphans: String(list.groupsSanitizeNotice.orphans),
                duplicates: String(list.groupsSanitizeNotice.duplicates),
              })}
            </p>
            <Button variant="ghost" size="sm" onClick={list.onDismissGroupsSanitizeNotice}>
              {t("vault.group.dismiss")}
            </Button>
          </div>
        ) : null}
        <VaultGroupsInvalidBanner
          visible={list.groupsInvalid}
          busy={list.groupsRepairBusy}
          budget={list.groupsRepairBudget}
          onRepair={list.onRepairGroups}
          onDismiss={list.onDismissGroupsInvalid}
        />
        <VaultListSectionHeader
          sort={list.sort}
          onSortChange={list.onSortChange}
          viewMode={list.viewMode}
          onViewModeChange={list.onViewModeChange}
          search={list.search}
          onSearchChange={list.onSearchChange}
          onNewVault={list.onNewVault}
        />
        <VaultList
          rows={list.displayRows}
          pipelineListStatus={list.pipelineListStatus}
          isVaultPipelineBusy={list.isVaultPipelineBusy}
          allVaultsHidden={list.allVaultsHidden}
          searchNoMatches={list.searchNoMatches}
          viewMode={list.viewMode}
          canReorder={list.canReorder}
          vaultListShowDrag={list.vaultListShowDrag}
          vaultListAllowDragIntoGroup={list.vaultListAllowDragIntoGroup}
          draggingId={list.draggingId}
          dragOverId={list.dragOverId}
          dragPointer={list.dragPointer}
          pointerDrag={list.pointerDrag}
          onCreateFromScratch={list.onCreateFromScratch}
          onImportPackage={list.onImportPackage}
          onOpenBackups={list.onOpenBackups}
          onOpenNote={list.onOpenNote}
          onOpenVaultInfo={list.onOpenVaultInfo}
          onOpenSettings={list.onOpenSettings}
          onOpenGroupSettings={list.onOpenGroupSettings}
          onToggleGroupCollapsed={list.onToggleGroupCollapsed}
          onExportVault={list.onExportVault}
          onOpenFileManager={screen.openFromVault}
          onLockVault={list.onLockVault}
          onUnlockVault={list.onUnlockVault}
        />
        {importDrop.isImportDropActive ? (
          <div
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/10"
            aria-hidden
          >
            <p className="px-4 text-center font-mono text-sm uppercase tracking-widest text-primary">
              {t("empty.drop_file_overlay")}
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
      <ExportVaultModal
        vault={exportVault.vault}
        open={exportVault.open}
        submitting={exportVault.submitting}
        onClose={exportVault.onClose}
        onConfirm={exportVault.onConfirm}
        onTimeout={exportVault.onTimeout}
      />
      <VaultSettingsModal
        vault={settings.vault}
        area={settings.area}
        open={settings.open}
        onClose={settings.onClose}
        pipelineListStatus={list.pipelineListStatus}
        onVaultSettingsSaved={settings.onVaultSettingsSaved}
        onPersistBusyChange={settings.onPersistBusyChange}
        onVaultDelete={settings.onVaultDelete}
        groups={settings.groups}
        onCommitGroupAssignment={settings.onCommitGroupAssignment}
      />
      <VaultGroupSettingsModal
        group={groupSettings.group}
        vaults={groupSettings.vaults}
        groups={groupSettings.groups}
        includeHidden={groupSettings.includeHidden}
        open={groupSettings.open}
        onClose={groupSettings.onClose}
        onSave={groupSettings.onSave}
        onDelete={groupSettings.onDelete}
        onBusyTimeout={groupSettings.onBusyTimeout}
      />
      <FileManagerLayer />
      <AppSettingsModal
        open={appSettings.open}
        onClose={appSettings.onClose}
        onDirtyChange={appSettings.onDirtyChange}
        hasOpenVault={!appConfigEditAllowed("workspace.path", list.vaults, list.pipelineListStatus)}
      />
      <VaultGroupsModal
        open={groupsModal.open}
        vaults={groupsModal.vaults}
        groups={groupsModal.groups}
        includeHidden={groupsModal.includeHidden}
        onCreateGroup={groupsModal.onCreateGroup}
        onClose={groupsModal.onClose}
        onDirtyChange={groupsModal.onDirtyChange}
      />
      <VaultRootDataFolderModal
        open={dataFolder.open}
        onClose={dataFolder.onClose}
        onDirtyChange={dataFolder.onDirtyChange}
        vaultActivityBlocksChange={
          !appConfigEditAllowed("data_folder", list.vaults, list.pipelineListStatus)
        }
      />
      <LogsModal open={logs.open} onClose={logs.onClose} />
      <HelpModal open={help.open} onClose={help.onClose} />
      <SystemInfoModal
        open={systemInfo.open}
        onClose={systemInfo.onClose}
        vaults={list.vaults}
        groups={list.groups}
      />
      <VaultInfoModal
        vault={vaultInfo.vault}
        open={vaultInfo.open}
        onClose={vaultInfo.onClose}
        groups={list.groups}
        pipelineListStatus={list.pipelineListStatus}
      />
      <CreateVaultModal
        open={createVault.open}
        existingVaultIds={createVault.existingVaultIds}
        existingOrders={createVault.existingOrders}
        groups={createVault.groups}
        initialDraft={createVault.initialDraft}
        initialStep={createVault.initialStep}
        onClose={createVault.onClose}
        onCreate={createVault.onCreate}
      />
    </AppShell>
  );
}
