import { useMemo, useState } from "react";
import type { CreateVaultDraft, CreateVaultStepId, VaultGroup, VaultListItem } from "@upriv/shared";
import type { VaultLifecycleRequest } from "@/features/vaults/lifecycle";
import type { VaultListModalsHandle } from "../vaultListModalsTypes";

export function useVaultListModals(
  vaults: VaultListItem[],
  groups: VaultGroup[] = [],
): VaultListModalsHandle {
  const [noteVaultId, setNoteVaultId] = useState<string | null>(null);
  const [backupVaultId, setBackupVaultId] = useState<string | null>(null);
  const [settingsVaultId, setSettingsVaultId] = useState<string | null>(null);
  const [groupAssignmentVaultId, setGroupAssignmentVaultId] = useState<string | null>(null);
  const [settingsGroupId, setSettingsGroupId] = useState<string | null>(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [dataFolderOpen, setDataFolderOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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

  const groupAssignmentVault = useMemo(
    () => vaults.find((vault) => vault.id === groupAssignmentVaultId) ?? null,
    [vaults, groupAssignmentVaultId],
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

  const closeCreateVault = () => {
    setCreateVaultOpen(false);
    setCreateVaultInitialDraft(null);
    setCreateVaultInitialStep(null);
  };

  const [appSettingsDirty, setAppSettingsDirty] = useState(false);
  const [dataFolderDirty, setDataFolderDirty] = useState(false);

  const setAppSettingsOpenExclusive = (open: boolean): boolean => {
    if (open && dataFolderDirty) return false;
    if (open) setDataFolderOpen(false);
    setAppSettingsOpen(open);
    return true;
  };
  const setDataFolderOpenExclusive = (open: boolean): boolean => {
    if (open && appSettingsDirty) return false;
    if (open) setAppSettingsOpen(false);
    setDataFolderOpen(open);
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
    groupAssignmentVaultId,
    setGroupAssignmentVaultId,
    groupAssignmentVault,
    settingsGroupId,
    setSettingsGroupId,
    settingsGroup,
    appSettingsOpen,
    setAppSettingsOpen: setAppSettingsOpenExclusive,
    setAppSettingsDirty,
    dataFolderOpen,
    setDataFolderOpen: setDataFolderOpenExclusive,
    setDataFolderDirty,
    logsOpen,
    setLogsOpen,
    helpOpen,
    setHelpOpen,
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
  };
}
