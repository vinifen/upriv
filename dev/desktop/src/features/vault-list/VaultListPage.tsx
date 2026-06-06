import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSettingsModal, useAppSettingsContext } from "@/features/app-settings";
import { CreateVaultWizardModal, type CreateVaultResult } from "@/features/vault-create";
import { FileManagerLayer, useFileManager } from "@/features/file-manager";
import { HelpModal } from "@/features/help";
import { LogsModal } from "@/features/logs";
import { useTranslation } from "@/i18n";
import { registerMockVaultSettings } from "./mockVaultSettings";
import { MOCK_VAULTS } from "./mockVaults";
import { VaultList } from "./VaultList";
import { VaultListHeader, useRefreshState } from "./VaultListHeader";
import { VaultListSectionHeader } from "./VaultListSectionHeader";
import { VaultBackupsModal } from "./VaultBackupsModal";
import { VaultNoteModal } from "./VaultNoteModal";
import { VaultSettingsModal } from "./VaultSettingsModal";
import { VaultLifecycleModal } from "./VaultLifecycleModal";
import {
  clearVaultPasswordInRam,
  setVaultPasswordInRam,
} from "./mockVaultSessionPassword";
import type { VaultLifecycleRequest } from "./vaultLifecycleTypes";
import type { VaultListItem } from "./types";
import type { VaultListSort } from "./vaultListSort";
import type { VaultListViewMode } from "./vaultListView";
import { useVaultListState } from "./useVaultListState";

export function VaultListPage() {
  const { t } = useTranslation();
  const { openFromVault, close: closeFileManager } = useFileManager();
  const { settings, patchSettings, showHiddenVaultsSession } = useAppSettingsContext();
  const showHiddenVaults =
    settings.ui.always_show_hidden_vaults || showHiddenVaultsSession;
  const { isRefreshing, refresh: runRefreshAnimation } = useRefreshState();
  const [noteVaultId, setNoteVaultId] = useState<string | null>(null);
  const [backupVaultId, setBackupVaultId] = useState<string | null>(null);
  const [settingsVaultId, setSettingsVaultId] = useState<string | null>(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createVaultOpen, setCreateVaultOpen] = useState(false);
  const [lifecycleRequest, setLifecycleRequest] = useState<VaultLifecycleRequest | null>(null);
  const [lifecycleSubmitting, setLifecycleSubmitting] = useState(false);

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
    addVault,
    setVaultRuntimeState,
    updateVaultSettings,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  } = useVaultListState(MOCK_VAULTS, { ...listDefaults, showHiddenVaults });

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

  const lifecycleVault = useMemo(
    () =>
      lifecycleRequest ? vaults.find((vault) => vault.id === lifecycleRequest.vaultId) ?? null : null,
    [lifecycleRequest, vaults],
  );

  useEffect(() => {
    for (const vault of vaults) {
      if (vault.session === "open") setVaultPasswordInRam(vault.id);
    }
  }, [vaults]);

  const existingVaultIds = useMemo(() => vaults.map((vault) => vault.id), [vaults]);
  const existingOrders = useMemo(
    () => vaults.map((vault) => vault.order ?? 0),
    [vaults],
  );

  const handleCreateVault = useCallback(
    (result: CreateVaultResult) => {
      registerMockVaultSettings(result.settings);
      addVault({
        id: result.vaultId,
        displayName: result.displayName,
        persistence: "sealed",
        session: null,
        storageMode: result.storageMode,
        order: result.order,
        canSeal: false,
        lastAccessedWhen: t("vault.create.just_created"),
        lastAccessedAt: new Date().toISOString(),
        note: result.note,
        passwordHint: result.passwordHint || undefined,
        hidden: result.settings.vault.hidden,
      });
    },
    [addVault, t],
  );

  const handleRefresh = useCallback(() => {
    resetList();
    runRefreshAnimation();
  }, [resetList, runRefreshAnimation]);

  const handleLockVault = useCallback((vault: VaultListItem) => {
    const intent = vault.storageMode === "plain" ? "seal" : "close";
    setLifecycleRequest({ vaultId: vault.id, intent });
  }, []);

  const handleUnlockVault = useCallback((vault: VaultListItem) => {
    setLifecycleRequest({ vaultId: vault.id, intent: "unlock" });
  }, []);

  const handleSealVault = useCallback((vault: VaultListItem) => {
    setLifecycleRequest({ vaultId: vault.id, intent: "seal" });
  }, []);

  const handleLifecycleConfirm = useCallback(
    async (_password: string | null) => {
      if (!lifecycleRequest) return;
      const { vaultId, intent } = lifecycleRequest;

      setLifecycleSubmitting(true);
      try {
        await new Promise((resolve) => setTimeout(resolve, 500));

        if (intent === "unlock") {
          setVaultRuntimeState(vaultId, { session: "open", persistence: "closed" });
          setVaultPasswordInRam(vaultId);
        } else if (intent === "close") {
          closeFileManager(vaultId);
          setVaultRuntimeState(vaultId, { session: null, persistence: "closed" });
          clearVaultPasswordInRam(vaultId);
        } else {
          closeFileManager(vaultId);
          setVaultRuntimeState(vaultId, { session: null, persistence: "sealed" });
          clearVaultPasswordInRam(vaultId);
        }

        setLifecycleRequest(null);
      } finally {
        setLifecycleSubmitting(false);
      }
    },
    [closeFileManager, lifecycleRequest, setVaultRuntimeState],
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-on-surface">
      <VaultListHeader
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        onOpenSystemSettings={() => setAppSettingsOpen(true)}
        onViewLogs={() => setLogsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onNewVault={() => setCreateVaultOpen(true)}
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
            allVaultsHidden={
              displayVaults.length === 0 && vaults.some((vault) => vault.hidden)
            }
            viewMode={viewMode}
            canReorder={canReorder}
            draggingId={draggingId}
            dragOverId={dragOverId}
            onOpenBackups={setBackupVaultId}
            onOpenNote={setNoteVaultId}
            onOpenSettings={setSettingsVaultId}
            onOpenFileManager={openFromVault}
            onLockVault={handleLockVault}
            onUnlockVault={handleUnlockVault}
            onSealVault={handleSealVault}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          />
        </section>
      </main>
      <VaultLifecycleModal
        vault={lifecycleVault}
        intent={lifecycleRequest?.intent ?? null}
        open={lifecycleRequest !== null}
        submitting={lifecycleSubmitting}
        onClose={() => {
          if (!lifecycleSubmitting) setLifecycleRequest(null);
        }}
        onConfirm={handleLifecycleConfirm}
      />
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
        onVaultDelete={(vaultId) => {
          closeFileManager(vaultId);
          removeVault(vaultId);
        }}
      />
      <FileManagerLayer />
      <AppSettingsModal open={appSettingsOpen} onClose={() => setAppSettingsOpen(false)} />
      <LogsModal open={logsOpen} onClose={() => setLogsOpen(false)} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <CreateVaultWizardModal
        open={createVaultOpen}
        existingVaultIds={existingVaultIds}
        existingOrders={existingOrders}
        onClose={() => setCreateVaultOpen(false)}
        onCreate={handleCreateVault}
      />
    </div>
  );
}
