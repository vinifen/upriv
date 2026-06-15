import type { CreateVaultDraft, VaultLifecycleRequest, VaultListItem } from "@upriv/shared";

/** Modal open/close state wired by `useVaultListModals` and consumed by the list screen. */
export interface VaultListModalsHandle {
  noteVaultId: string | null;
  setNoteVaultId: (id: string | null) => void;
  noteVault: VaultListItem | null;
  backupVaultId: string | null;
  setBackupVaultId: (id: string | null) => void;
  backupVault: VaultListItem | null;
  settingsVaultId: string | null;
  setSettingsVaultId: (id: string | null) => void;
  settingsVault: VaultListItem | null;
  appSettingsOpen: boolean;
  setAppSettingsOpen: (open: boolean) => void;
  logsOpen: boolean;
  setLogsOpen: (open: boolean) => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  createVaultOpen: boolean;
  setCreateVaultOpen: (open: boolean) => void;
  createVaultInitialDraft: CreateVaultDraft | null;
  setCreateVaultInitialDraft: (draft: CreateVaultDraft | null) => void;
  closeCreateVault: () => void;
  lifecycleRequest: VaultLifecycleRequest | null;
  setLifecycleRequest: (request: VaultLifecycleRequest | null) => void;
  lifecycleVault: VaultListItem | null;
  recoveryVaultId: string | null;
  setRecoveryVaultId: (id: string | null) => void;
  recoveryVault: VaultListItem | null;
  recoverySubmitting: boolean;
  setRecoverySubmitting: (submitting: boolean) => void;
}

/** Subset of modal handles that vault lifecycle actions need. */
export type VaultListLifecycleModals = Pick<
  VaultListModalsHandle,
  | "setLifecycleRequest"
  | "lifecycleRequest"
  | "lifecycleVault"
  | "setRecoveryVaultId"
  | "recoveryVaultId"
  | "setRecoverySubmitting"
>;
