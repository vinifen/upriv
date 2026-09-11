import { useMemo, useState } from "react";
import type {
  CreateVaultDraft,
  CreateVaultStepId,
  VaultGroup,
  VaultListItem,
  VaultSettingsAreaId,
} from "@upriv/shared";
import type { VaultLifecycleRequest } from "@/features/vaults/lifecycle";
import type { VaultListModalsHandle } from "../vaultListModalsTypes";

export function useVaultListModals(
  vaults: VaultListItem[],
  groups: VaultGroup[] = [],
): VaultListModalsHandle {
  const [noteVaultId, setNoteVaultId] = useState<string | null>(null);
  const [backupVaultId, setBackupVaultId] = useState<string | null>(null);
  const [settingsVaultId, setSettingsVaultId] = useState<string | null>(null);
  const [settingsArea, setSettingsArea] = useState<VaultSettingsAreaId | null>(null);
  const [settingsGroupId, setSettingsGroupId] = useState<string | null>(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [dataFolderOpen, setDataFolderOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [systemInfoOpen, setSystemInfoOpen] = useState(false);
  const [vaultInfoVaultId, setVaultInfoVaultId] = useState<string | null>(null);
  const [createVaultOpen, setCreateVaultOpen] = useState(false);
  const [createVaultInitialDraft, setCreateVaultInitialDraft] = useState<CreateVaultDraft | null>(
    null,
  );
  const [createVaultInitialStep, setCreateVaultInitialStep] = useState<CreateVaultStepId | null>(
    null,
  );
  const [lifecycleRequest, setLifecycleRequest] = useState<VaultLifecycleRequest | null>(null);
  const [recoveryVaultId, setRecoveryVaultId] = useState<string | null>(null);
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [exportVaultId, setExportVaultId] = useState<string | null>(null);
  const [exportSubmitting, setExportSubmitting] = useState(false);

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

  const settingsGroup = useMemo(
    () => groups.find((group) => group.id === settingsGroupId) ?? null,
    [groups, settingsGroupId],
  );

  const lifecycleVault = useMemo(
    () =>
      lifecycleRequest
        ? (vaults.find((vault) => vault.id === lifecycleRequest.vaultId) ?? null)
        : null,
    [lifecycleRequest, vaults],
  );

  const recoveryVault = useMemo(
    () => vaults.find((vault) => vault.id === recoveryVaultId) ?? null,
    [vaults, recoveryVaultId],
  );

  const exportVault = useMemo(
    () => vaults.find((vault) => vault.id === exportVaultId) ?? null,
    [vaults, exportVaultId],
  );

  const vaultInfoVault = useMemo(
    () => vaults.find((vault) => vault.id === vaultInfoVaultId) ?? null,
    [vaults, vaultInfoVaultId],
  );

  const closeCreateVault = () => {
    setCreateVaultOpen(false);
    setCreateVaultInitialDraft(null);
    setCreateVaultInitialStep(null);
  };

  const [appSettingsDirty, setAppSettingsDirty] = useState(false);
  const [dataFolderDirty, setDataFolderDirty] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupsDirty, setGroupsDirty] = useState(false);

  const setAppSettingsOpenExclusive = (open: boolean): boolean => {
    if (open && (dataFolderDirty || groupsDirty)) return false;
    if (open) {
      setDataFolderOpen(false);
      setGroupsOpen(false);
    }
    setAppSettingsOpen(open);
    return true;
  };
  const setDataFolderOpenExclusive = (open: boolean): boolean => {
    if (open && (appSettingsDirty || groupsDirty)) return false;
    if (open) {
      setAppSettingsOpen(false);
      setGroupsOpen(false);
    }
    setDataFolderOpen(open);
    return true;
  };
  const setGroupsOpenExclusive = (open: boolean): boolean => {
    if (open && (appSettingsDirty || dataFolderDirty)) return false;
    if (open) {
      setAppSettingsOpen(false);
      setDataFolderOpen(false);
    }
    setGroupsOpen(open);
    return true;
  };

  return {
    noteVaultId,
    setNoteVaultId,
    noteVault,
    backupVaultId,
    setBackupVaultId,
    backupVault,
    settingsVaultId,
    setSettingsVaultId,
    settingsVault,
    settingsArea,
    setSettingsArea,
    settingsGroupId,
    setSettingsGroupId,
    settingsGroup,
    appSettingsOpen,
    appSettingsDirty,
    setAppSettingsOpen: setAppSettingsOpenExclusive,
    setAppSettingsDirty,
    dataFolderOpen,
    dataFolderDirty,
    setDataFolderOpen: setDataFolderOpenExclusive,
    setDataFolderDirty,
    groupsOpen,
    groupsDirty,
    setGroupsOpen: setGroupsOpenExclusive,
    setGroupsDirty,
    logsOpen,
    setLogsOpen,
    helpOpen,
    setHelpOpen,
    systemInfoOpen,
    setSystemInfoOpen,
    vaultInfoVaultId,
    setVaultInfoVaultId,
    vaultInfoVault,
    createVaultOpen,
    setCreateVaultOpen,
    createVaultInitialDraft,
    setCreateVaultInitialDraft,
    createVaultInitialStep,
    setCreateVaultInitialStep,
    closeCreateVault,
    lifecycleRequest,
    setLifecycleRequest,
    lifecycleVault,
    recoveryVaultId,
    setRecoveryVaultId,
    recoveryVault,
    recoverySubmitting,
    setRecoverySubmitting,
    exportVaultId,
    setExportVaultId,
    exportVault,
    exportSubmitting,
    setExportSubmitting,
  };
}
