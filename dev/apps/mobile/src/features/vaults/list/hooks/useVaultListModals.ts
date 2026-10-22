import { useRef, useState } from "react";
import type {
  CreateVaultDraft,
  CreateVaultStepId,
  GroupedVaultSortMode,
  VaultExportFormat,
  VaultGroup,
  VaultLifecycleRequest,
  VaultListItem,
  VaultListSortDirection,
  VaultSettingsAreaId,
} from "@upriv/shared";

export function useVaultListModals() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [dataFolderOpen, setDataFolderOpen] = useState(false);
  const [dataFolderDirty, setDataFolderDirty] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupsDirty, setGroupsDirty] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [systemInfoOpen, setSystemInfoOpen] = useState(false);
  const [vaultInfoVaultId, setVaultInfoVaultId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateVaultDraft | null>(null);
  const [createStep, setCreateStep] = useState<CreateVaultStepId | null>(null);
  const [lifecycleRequest, setLifecycleRequest] = useState<VaultLifecycleRequest | null>(null);
  const [settingsVault, setSettingsVault] = useState<VaultListItem | null>(null);
  const [settingsArea, setSettingsArea] = useState<VaultSettingsAreaId | null>(null);
  const [noteVaultId, setNoteVaultId] = useState<string | null>(null);
  const [exportVault, setExportVault] = useState<VaultListItem | null>(null);
  /** The export in flight: its job id (`job_status`, `job_cancel`), vault, format, and start. */
  const [exportJob, setExportJob] = useState<{
    id: string;
    vaultId: string;
    format: VaultExportFormat;
    startedAt: number;
  } | null>(null);
  /** The password a `.7z` export was refused with (wrong, or the unlock limit), on its field. */
  const [exportPasswordError, setExportPasswordError] = useState<{
    vaultId: string;
    message: string;
  } | null>(null);
  const [backupsVault, setBackupsVault] = useState<VaultListItem | null>(null);
  const [settingsGroup, setSettingsGroup] = useState<VaultGroup | null>(null);
  const settingsGroupOpenRef = useRef(false);
  settingsGroupOpenRef.current = settingsGroup !== null;
  const [groupDraftName, setGroupDraftName] = useState("");
  const [groupDraftOrder, setGroupDraftOrder] = useState(0);
  const [groupDraftGroupedVaults, setGroupDraftGroupedVaults] = useState<string[]>([]);
  const [groupDraftGroupedVaultSort, setGroupDraftGroupedVaultSort] =
    useState<GroupedVaultSortMode>("order");
  const [groupDraftGroupedVaultSortDirection, setGroupDraftGroupedVaultSortDirection] =
    useState<VaultListSortDirection>("asc");
  const [groupDraftHidden, setGroupDraftHidden] = useState(false);
  const [groupDeleteOpen, setGroupDeleteOpen] = useState(false);
  const [groupFormError, setGroupFormError] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);

  return {
    settingsOpen,
    setSettingsOpen,
    settingsDirty,
    setSettingsDirty,
    dataFolderOpen,
    setDataFolderOpen,
    dataFolderDirty,
    setDataFolderDirty,
    groupsOpen,
    setGroupsOpen,
    groupsDirty,
    setGroupsDirty,
    logsOpen,
    setLogsOpen,
    helpOpen,
    setHelpOpen,
    systemInfoOpen,
    setSystemInfoOpen,
    vaultInfoVaultId,
    setVaultInfoVaultId,
    createOpen,
    setCreateOpen,
    createDraft,
    setCreateDraft,
    createStep,
    setCreateStep,
    lifecycleRequest,
    setLifecycleRequest,
    settingsVault,
    setSettingsVault,
    settingsArea,
    setSettingsArea,
    noteVaultId,
    setNoteVaultId,
    exportVault,
    setExportVault,
    exportJob,
    setExportJob,
    exportPasswordError,
    setExportPasswordError,
    backupsVault,
    setBackupsVault,
    settingsGroup,
    setSettingsGroup,
    settingsGroupOpenRef,
    groupDraftName,
    setGroupDraftName,
    groupDraftOrder,
    setGroupDraftOrder,
    groupDraftGroupedVaults,
    setGroupDraftGroupedVaults,
    groupDraftGroupedVaultSort,
    setGroupDraftGroupedVaultSort,
    groupDraftGroupedVaultSortDirection,
    setGroupDraftGroupedVaultSortDirection,
    groupDraftHidden,
    setGroupDraftHidden,
    groupDeleteOpen,
    setGroupDeleteOpen,
    groupFormError,
    setGroupFormError,
    groupBusy,
    setGroupBusy,
    repairBusy,
    setRepairBusy,
  };
}
