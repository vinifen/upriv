import type {
  CreateVaultDraft,
  CreateVaultStepId,
  VaultGroup,
  VaultLifecycleRequest,
  VaultListItem,
  VaultSettingsAreaId,
} from "@upriv/shared";

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
  settingsArea: VaultSettingsAreaId | null;
  setSettingsArea: (area: VaultSettingsAreaId | null) => void;
  settingsGroupId: string | null;
  setSettingsGroupId: (id: string | null) => void;
  settingsGroup: VaultGroup | null;
  appSettingsOpen: boolean;
  appSettingsDirty: boolean;
  /** Returns false when Data folder or Groups has unsaved edits (caller should toast). */
  setAppSettingsOpen: (open: boolean) => boolean;
  setAppSettingsDirty: (dirty: boolean) => void;
  dataFolderOpen: boolean;
  dataFolderDirty: boolean;
  /** Returns false when System settings or Groups has unsaved edits. */
  setDataFolderOpen: (open: boolean) => boolean;
  setDataFolderDirty: (dirty: boolean) => void;
  groupsOpen: boolean;
  groupsDirty: boolean;
  /** Returns false when System settings or Data folder has unsaved edits. */
  setGroupsOpen: (open: boolean) => boolean;
  setGroupsDirty: (dirty: boolean) => void;
  logsOpen: boolean;
  setLogsOpen: (open: boolean) => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
  systemInfoOpen: boolean;
  setSystemInfoOpen: (open: boolean) => void;
  vaultInfoVaultId: string | null;
  setVaultInfoVaultId: (id: string | null) => void;
  vaultInfoVault: VaultListItem | null;
  createVaultOpen: boolean;
  setCreateVaultOpen: (open: boolean) => void;
  createVaultInitialDraft: CreateVaultDraft | null;
  setCreateVaultInitialDraft: (draft: CreateVaultDraft | null) => void;
  /** When set with an initial draft, wizard opens on this step (else backup skips to identity). */
  createVaultInitialStep: CreateVaultStepId | null;
  setCreateVaultInitialStep: (step: CreateVaultStepId | null) => void;
  closeCreateVault: () => void;
  lifecycleRequest: VaultLifecycleRequest | null;
  setLifecycleRequest: (request: VaultLifecycleRequest | null) => void;
  lifecycleVault: VaultListItem | null;
  recoveryVaultId: string | null;
  setRecoveryVaultId: (id: string | null) => void;
  recoveryVault: VaultListItem | null;
  recoverySubmitting: boolean;
  setRecoverySubmitting: (submitting: boolean) => void;
  exportVaultId: string | null;
  setExportVaultId: (id: string | null) => void;
  exportVault: VaultListItem | null;
  exportSubmitting: boolean;
  setExportSubmitting: (submitting: boolean) => void;
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
  | "setExportVaultId"
  | "exportVault"
  | "setExportSubmitting"
  | "setCreateVaultOpen"
  | "setCreateVaultInitialDraft"
  | "setCreateVaultInitialStep"
>;
