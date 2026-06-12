import { useMemo, useState } from "react";
import type { CreateVaultDraft, VaultListItem } from "@upriv/shared";
import type { VaultLifecycleRequest } from "@/features/vault-lifecycle";

export function useVaultListModals(vaults: VaultListItem[]) {
  const [noteVaultId, setNoteVaultId] = useState<string | null>(null);
  const [backupVaultId, setBackupVaultId] = useState<string | null>(null);
  const [settingsVaultId, setSettingsVaultId] = useState<string | null>(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createVaultOpen, setCreateVaultOpen] = useState(false);
  const [createVaultInitialDraft, setCreateVaultInitialDraft] = useState<CreateVaultDraft | null>(
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
    appSettingsOpen,
    setAppSettingsOpen,
    logsOpen,
    setLogsOpen,
    helpOpen,
    setHelpOpen,
    createVaultOpen,
    setCreateVaultOpen,
    createVaultInitialDraft,
    setCreateVaultInitialDraft,
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
