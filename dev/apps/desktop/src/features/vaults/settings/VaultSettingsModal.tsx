import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, ContentSkeleton, ElapsedTime, JobStopButton, Modal } from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";
import { useErrorToast } from "@/hooks/useErrorToast";
import {
  useOperationLimit,
  usePasswordWeakness,
  type VaultRewrapJob,
  type VaultRewrapOutcome,
} from "@upriv/shared/react";
import { useVaultRootService, useVaultService } from "@/platform/services";
import {
  VaultChangeKdfFields,
  VaultChangePasswordFields,
  VaultSettingsBackupSection,
  VaultSettingsCloseSection,
  VaultSettingsDangerZoneSection,
  VaultSettingsMountSection,
  VaultSettingsStorageSection,
  VaultSettingsVaultSection,
  VaultSettingsGroupSection,
  VaultSettingsSection,
} from "@/components/settings";
import { useAppSettingsContext } from "@/features/system/settings";
import { useVaultSettings } from "./hooks/useVaultSettings";
import type {
  ChangeKdfFieldsState,
  ChangePasswordFieldsState,
  CreateVaultGroupAssignment,
  StorageMode,
  VaultConfigEditHold,
  VaultGroup,
  VaultListItem,
  VaultSettingsAreaId,
  VaultSettingsConfig,
  VaultSettingsListPatch,
  VaultSettingsSectionId,
  WorkspaceTable,
  VaultPipelineListStatus,
  KdfUnlockPreset,
  VaultRewrapKind,
  BackupFolderTable,
  VaultBackupFolders,
} from "@upriv/shared";
import {
  backupFolderLeftBehind,
  backupFolderSystem,
  currentWorkspaceSystem,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  changeKdfFormCanSubmit,
  DEFAULT_KDF_UNLOCK_PRESET,
  changeKdfFormIsDirty,
  changePasswordFormCanSubmit,
  changePasswordFormIsDirty,
  vaultPublicText,
  displayNameErrorI18nKey,
  EMPTY_CHANGE_PASSWORD_FIELDS,
  errorDisplayI18nKey,
  errorOnPasswordField,
  NO_VAULT_GROUPS,
  isVaultInHiddenGroup,
  isHiddenGroup,
  resolveVaultListStatus,
  selectedGroupIdAfterAssignment,
  normalizeVaultSettingsConfig,
  peekVaultSettings,
  vaultSettingsEqual,
  vaultSettingsEqualIgnoringIdentity,
  patchStorageMode,
  validateDisplayName,
  vaultSettingsAreaTitleKey,
  VAULT_SETTINGS_AREA_ICON,
  vaultSettingsPreferenceSections,
  vaultSettingsToListPatch,
  vaultSettingsIdentityListPatch,
  vaultRootPathForWorkspaceValidation,
  vaultConfigEditAllowed,
  vaultConfigEditHold,
  vaultDeleteHold,
  vaultRowControls,
  rebaseQuietLockedVaultSettings,
  normalizeStoredName,
} from "@upriv/shared";
import { createVaultErrorI18nKey, desktopErrorI18nKey } from "@/lib/errorMessages";

const SAVED_INDICATOR_MS = 1500;

type RewrapFailure = {
  vaultId: string;
  kind: VaultRewrapKind;
  message: string;
  onPasswordField: boolean;
};

/** A Save still in flight, or one that failed, which the window shows again on reopen. */
type PendingSave = {
  vaultId: string;
  area: VaultSettingsAreaId;
  /** The values being saved, or the ones that did not save. */
  config: VaultSettingsConfig | null;
  /** `null` while it runs; the error line once it failed. */
  failure: string | null;
};

interface VaultSettingsModalProps {
  vault: VaultListItem | null;
  /** Which settings screen the gear menu opened. */
  area: VaultSettingsAreaId | null;
  open: boolean;
  onClose: () => void;
  /** List pipeline — gates quiet vs closed edits (see edit-policy). */
  pipelineListStatus?: VaultPipelineListStatus;
  groups?: readonly VaultGroup[];
  onVaultSettingsSaved?: (vaultId: string, patch: VaultSettingsListPatch) => void;
  /** Block Open/Unlock for these vault ids while preferences persist is in flight. */
  onPersistBusyChange?: (vaultIds: readonly string[] | null) => void;
  onCommitGroupAssignment?: (
    vaultId: string,
    assignment: CreateVaultGroupAssignment,
  ) => Promise<void> | void;
  onVaultDelete?: (vaultId: string, outsideBackups: boolean) => Promise<void> | void;
  /** List toast. A save or a rewrap can finish after this modal closes. */
  onNotice?: (message: string) => void;
  /** The password or unlock-RAM change in flight; the list owns it. */
  rewrapJob?: VaultRewrapJob | null;
  /** How the last change ended, so the window resets its form or marks the field. */
  rewrapOutcome?: VaultRewrapOutcome | null;
  /** False while another change runs. */
  onChangePassword?: (vaultId: string, currentPassword: string, newPassword: string) => boolean;
  onChangeKdf?: (vaultId: string, currentPassword: string, nextPreset: KdfUnlockPreset) => boolean;
  onStopRewrap?: () => void;
}

export function VaultSettingsModal({
  vault,
  area,
  open,
  onClose,
  pipelineListStatus = {},
  groups = NO_VAULT_GROUPS,
  onVaultSettingsSaved,
  onPersistBusyChange,
  onCommitGroupAssignment,
  onVaultDelete,
  onNotice,
  rewrapJob = null,
  rewrapOutcome = null,
  onChangePassword,
  onChangeKdf,
  onStopRewrap,
}: VaultSettingsModalProps) {
  const { t } = useTranslation();
  const { showError, show } = useErrorToast();
  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;
  const notice = useCallback(
    (message: string) => {
      const report = onNoticeRef.current;
      if (report) report(message);
      else show(message);
    },
    [show],
  );
  const { settings: appSettings, showHiddenVaultsSession } = useAppSettingsContext();
  const vaultService = useVaultService();
  const vaultRootService = useVaultRootService();
  const vaultId = vault?.id ?? null;
  const activeArea = open ? area : null;
  const { config, loading, loadError, replaceConfig, invalidateLoad, retryLoad } = useVaultSettings(
    vaultId,
    open,
  );

  const [draft, setDraft] = useState<VaultSettingsConfig | null>(null);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [passwordFields, setPasswordFields] = useState<ChangePasswordFieldsState>(
    EMPTY_CHANGE_PASSWORD_FIELDS,
  );
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [kdfFields, setKdfFields] = useState<ChangeKdfFieldsState | null>(null);
  const [kdfError, setKdfError] = useState<string | null>(null);
  const [rewrapFailure, setRewrapFailure] = useState<RewrapFailure | null>(null);
  const [headerUnlockPreset, setHeaderUnlockPreset] = useState<KdfUnlockPreset | undefined>();
  const [sectionBusy, setSectionBusy] = useState(false);
  /** Outlives closing the window: a save keeps running and its result still applies. */
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [mountPathIssue, setMountPathIssue] = useState(false);
  const [mountDriverAttention, setMountDriverAttention] = useState(false);
  const [backupFolderBlocking, setBackupFolderBlocking] = useState(false);
  const [removeOutsideBackups, setRemoveOutsideBackups] = useState(false);
  const [resolvedRootPath, setResolvedRootPath] = useState<string | null>(null);
  /** Invalidates a submit that ran past `OPERATION_LIMIT_MS`. */
  const sectionBusyGenRef = useRef(0);
  /** Sync lock — React `sectionBusy` paints too late for double-click. */
  const submitInFlightRef = useRef(false);
  const rewrapJobRef = useRef(rewrapJob);
  rewrapJobRef.current = rewrapJob;
  const rewrapFailureRef = useRef<RewrapFailure | null>(null);
  const openRef = useRef(open);
  const areaRef = useRef(activeArea);
  const vaultIdRef = useRef(vaultId);
  openRef.current = open;
  areaRef.current = activeArea;
  vaultIdRef.current = vaultId;
  rewrapFailureRef.current = rewrapFailure;

  const confirmInputId = useId();
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedForVaultRef = useRef<string | null>(null);
  const draftTouchedRef = useRef(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  /** Skip draft wipe / settings reload when save remounts onto the new id. */
  const identityMigratingRef = useRef(false);
  const identityMigratingToRef = useRef<string | null>(null);
  /** True after `vault_rename` returns; timeout must not treat identity as failed. */
  const renameCommittedRef = useRef(false);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const showHiddenVaults = appSettings.ui.always_show_hidden_vaults || showHiddenVaultsSession;
  const hiddenLocked = Boolean(vault && isVaultInHiddenGroup(groups, vault.id));

  const lockDraftHidden = useCallback(() => {
    setDraft((current) => {
      if (!current || current.vault.hidden) return current;
      return { ...current, vault: { ...current.vault, hidden: true } };
    });
    if (config && !config.vault.hidden) {
      replaceConfig({ ...config, vault: { ...config.vault, hidden: true } });
    }
  }, [config, replaceConfig]);

  useEffect(() => {
    if (!hiddenLocked) return;
    lockDraftHidden();
  }, [hiddenLocked, lockDraftHidden]);

  useEffect(() => {
    if (!open || !vaultId) {
      setHeaderUnlockPreset(undefined);
      return;
    }
    // List row already probed `header/vault.header`. Missing ≠ 256 MiB.
    setHeaderUnlockPreset(vault?.unlockPreset);
  }, [open, vaultId, vault?.unlockPreset]);

  useEffect(() => {
    if (!open) {
      setResolvedRootPath(null);
      setMountPathIssue(false);
      setMountDriverAttention(false);
      setBackupFolderBlocking(false);
      setRemoveOutsideBackups(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await vaultRootService.resolve({
          vaultRootMode: appSettings.app.vault_root_mode,
        });
        if (cancelled) return;
        if (resolved.status === "found") {
          setResolvedRootPath(resolved.rootPath);
        } else {
          setResolvedRootPath(resolved.defaultRootAnchor);
        }
      } catch {
        if (!cancelled) setResolvedRootPath(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, appSettings.app.vault_root_mode, vaultRootService]);

  const canConfirmDelete = vault !== null && deleteConfirm.trim() === vault.id;
  const vaultListStatus = vault ? resolveVaultListStatus(vault, pipelineListStatus) : "closed";
  const settingsSaveBlocked = Boolean(
    vault && vaultRowControls(vault, pipelineListStatus).settingsSaveBlocked,
  );
  const deleteHold = vault ? vaultDeleteHold(vault, pipelineListStatus) : "busy";
  const canDeleteNow = deleteHold === null;
  const editHold = vault ? vaultConfigEditHold(vault, pipelineListStatus) : {};
  const editAllowed = (target: Parameters<typeof vaultConfigEditAllowed>[0]) =>
    vault != null && vaultConfigEditAllowed(target, vault, pipelineListStatus);
  const storageModeLocked = !editAllowed("storage.mode");
  const plainFilesLocked = !editAllowed("storage.plain_files");
  const displayNameLocked = !editAllowed("vault.display_name");
  const mountLocked = !editAllowed("mount.workspace_path");
  /** password / KDF — `vault_closed`. */
  const rewrapBlocked = Boolean(
    vault && !vaultConfigEditAllowed("action.change_password", vault, pipelineListStatus),
  );

  const baseline = useMemo(() => (config ? normalizeVaultSettingsConfig(config) : null), [config]);

  const baselineGroupId = useMemo(
    () =>
      vaultId ? (groups.find((group) => group.groupedVaults.includes(vaultId))?.id ?? "") : "",
    [groups, vaultId],
  );

  const pendingGroupName = normalizeStoredName(newGroupName);
  const groupDirty = pendingGroupName.length > 0 || selectedGroupId !== baselineGroupId;

  const preferencesDirty = useMemo(
    () => Boolean(draft && baseline && !vaultSettingsEqual(draft, baseline)),
    [draft, baseline],
  );

  const passwordDirty = useMemo(() => changePasswordFormIsDirty(passwordFields), [passwordFields]);

  const kdfDirty = useMemo(() => {
    if (!kdfFields || headerUnlockPreset === undefined) return false;
    return changeKdfFormIsDirty({
      password: kdfFields.password,
      nextPreset: kdfFields.nextPreset,
      currentPreset: headerUnlockPreset,
    });
  }, [kdfFields, headerUnlockPreset]);

  const areaDirty =
    activeArea === "preferences"
      ? preferencesDirty
      : activeArea === "password"
        ? passwordDirty
        : activeArea === "kdf"
          ? kdfDirty
          : activeArea === "group"
            ? groupDirty
            : false;

  const passwordRewrapRunning = rewrapJob?.vaultId === vaultId && rewrapJob.kind === "password";
  const kdfRewrapRunning = rewrapJob?.vaultId === vaultId && rewrapJob.kind === "kdf";

  const passwordCanSubmit = changePasswordFormCanSubmit({
    ...passwordFields,
    vaultListStatus,
    submitting: passwordRewrapRunning,
  });

  const vaultText = useMemo(
    () =>
      vaultPublicText({
        displayName: vault?.displayName ?? "",
        passwordHint: config?.vault.password_hint ?? "",
        note: config?.vault.note ?? "",
      }),
    [vault?.displayName, config?.vault.password_hint, config?.vault.note],
  );
  const passwordWeakness = usePasswordWeakness(
    passwordFields.newPassword,
    vaultText,
    passwordFields.currentPassword,
  );

  const kdfCanSubmit =
    headerUnlockPreset !== undefined &&
    changeKdfFormCanSubmit({
      password: kdfFields?.password ?? "",
      nextPreset: kdfFields?.nextPreset ?? headerUnlockPreset,
      currentPreset: headerUnlockPreset,
      vaultListStatus,
      submitting: kdfRewrapRunning,
    });

  const resetPasswordForm = useCallback(() => {
    setPasswordFields(EMPTY_CHANGE_PASSWORD_FIELDS);
    setPasswordError(null);
  }, []);

  const resetKdfForm = useCallback(() => {
    setKdfFields(null);
    setKdfError(null);
  }, []);

  useEffect(() => {
    if (!open || !vaultId) return;
    if (openedForVaultRef.current === vaultId) return;
    if (identityMigratingRef.current) {
      const skip = identityMigratingToRef.current === vaultId;
      identityMigratingRef.current = false;
      identityMigratingToRef.current = null;
      if (skip) {
        openedForVaultRef.current = vaultId;
        return;
      }
    }
    openedForVaultRef.current = vaultId;
    draftTouchedRef.current = false;
    setSelectedGroupId(
      groupsRef.current.find((group) => group.groupedVaults.includes(vaultId))?.id ?? "",
    );
    setNewGroupName("");
  }, [open, vaultId]);

  useEffect(() => {
    if (!open || !config || !vaultId) return;
    if (openedForVaultRef.current !== vaultId) return;
    setDraft((current) => {
      const next = normalizeVaultSettingsConfig(config);
      if (draftTouchedRef.current && current) return current;
      return next;
    });
  }, [open, vaultId, config]);

  useEffect(() => {
    if (!open) {
      identityMigratingRef.current = false;
      identityMigratingToRef.current = null;
      setDraft(null);
      openedForVaultRef.current = null;
      setSaveConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
      setDeleteOpen(false);
      setDeleteConfirm("");
      setSelectedGroupId("");
      setNewGroupName("");
      if (!rewrapJobRef.current && !rewrapFailureRef.current) {
        resetPasswordForm();
        resetKdfForm();
      }
      setLoadTimedOut(false);
    }
  }, [open, vaultId, resetPasswordForm, resetKdfForm]);

  useEffect(() => {
    if (!open || !vaultId) return;
    const ownsForm =
      rewrapJobRef.current?.vaultId === vaultId || rewrapFailureRef.current?.vaultId === vaultId;
    if (ownsForm) return;
    resetPasswordForm();
    resetKdfForm();
  }, [open, resetKdfForm, resetPasswordForm, vaultId]);

  useEffect(() => {
    if (!areaDirty) setSaveConfirmOpen(false);
  }, [areaDirty]);

  useEffect(() => {
    return () => clearTimeout(savedHideRef.current);
  }, []);

  useEffect(() => {
    if (activeArea !== "kdf") return;
    setKdfFields((current) => {
      if (
        current &&
        (rewrapJobRef.current?.kind === "kdf" || rewrapFailureRef.current?.kind === "kdf")
      ) {
        return current;
      }
      return current
        ? { ...current, nextPreset: headerUnlockPreset ?? DEFAULT_KDF_UNLOCK_PRESET }
        : {
            password: "",
            nextPreset: headerUnlockPreset ?? DEFAULT_KDF_UNLOCK_PRESET,
          };
    });
  }, [activeArea, headerUnlockPreset]);

  const flashSaved = useCallback(() => {
    setSavedVisible(true);
    clearTimeout(savedHideRef.current);
    savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
  }, []);

  const persistPreferences = useCallback(
    async (next: VaultSettingsConfig) => {
      if (!vaultId || !baseline || !vault || !vaultService.canPersistSettings) return;
      if (vaultRowControls(vault, pipelineListStatus).settingsSaveBlocked) return;
      if (submitInFlightRef.current) return;
      submitInFlightRef.current = true;
      const rebased = rebaseQuietLockedVaultSettings(next, baseline, vault, pipelineListStatus);
      const normalized = normalizeVaultSettingsConfig(rebased);
      const locked = Boolean(vaultId && isVaultInHiddenGroup(groupsRef.current, vaultId));
      let toSave =
        locked && !normalized.vault.hidden
          ? { ...normalized, vault: { ...normalized.vault, hidden: true } }
          : normalized;
      const generation = (sectionBusyGenRef.current += 1);
      setSectionBusy(true);
      const fromId = vaultId;
      setPendingSave({ vaultId: fromId, area: "preferences", config: toSave, failure: null });
      let failure: string | null = null;
      renameCommittedRef.current = false;
      let renamedIdentity: { id: string; displayName: string } | null = null;
      /** The window still shows this vault; otherwise the outcome is a list toast. */
      const showing = () =>
        openRef.current &&
        (vaultIdRef.current === fromId || vaultIdRef.current === renamedIdentity?.id);
      onPersistBusyChange?.([fromId]);
      try {
        const nameDirty =
          toSave.vault.display_name !== normalizeStoredName(baseline.vault.display_name);
        if (nameDirty) {
          const validation = validateDisplayName(toSave.vault.display_name);
          if (validation) {
            show(
              t(
                displayNameErrorI18nKey(validation),
                validation === "too_long"
                  ? { max: String(VAULT_DISPLAY_NAME_MAX_LENGTH) }
                  : undefined,
              ),
            );
            return;
          }
          const renamed = await vaultService.rename(fromId, toSave.vault.display_name);
          toSave = {
            ...toSave,
            vault: {
              ...toSave.vault,
              id: renamed.id,
              display_name: renamed.displayName,
            },
          };
          renamedIdentity = { id: renamed.id, displayName: renamed.displayName };
          renameCommittedRef.current = true;
          if (renamed.id !== fromId) {
            identityMigratingRef.current = true;
            identityMigratingToRef.current = renamed.id;
            onPersistBusyChange?.([fromId, renamed.id]);
          }
          const stale = generation !== sectionBusyGenRef.current;
          if (!stale) {
            const identityBaseline = {
              ...baseline,
              vault: {
                ...baseline.vault,
                id: renamed.id,
                display_name: renamed.displayName,
              },
            };
            replaceConfig(identityBaseline);
            setDraft(toSave);
          }
          if (stale) {
            onVaultSettingsSaved?.(
              fromId,
              vaultSettingsIdentityListPatch(baseline, renamed.id, renamed.displayName),
            );
            return;
          }
        }
        const otherDirty = !vaultSettingsEqualIgnoringIdentity(baseline, toSave);
        if (!nameDirty && !otherDirty) {
          if (generation !== sectionBusyGenRef.current) return;
          setSaveConfirmOpen(false);
          return;
        }
        if (otherDirty) {
          await vaultService.registerSettings(toSave.vault.id, toSave);
        }
        onVaultSettingsSaved?.(fromId, vaultSettingsToListPatch(toSave));
        const backupSystem = backupFolderSystem(currentWorkspaceSystem());
        if (backupSystem) {
          const app = appSettings.backups[backupSystem];
          const leftBehind = backupFolderLeftBehind(
            { app, vault: baseline.backup[backupSystem] },
            { app, vault: toSave.backup[backupSystem] },
          );
          if (leftBehind) notice(t("toast.backup_folder_changed"));
        }
        if (generation !== sectionBusyGenRef.current) return;
        if (!showing()) {
          notice(t("toast.settings_saved_for", { name: toSave.vault.display_name }));
          return;
        }
        replaceConfig(toSave);
        setDraft(toSave);
        flashSaved();
        setSaveConfirmOpen(false);
      } catch (error) {
        if (renamedIdentity) {
          onVaultSettingsSaved?.(
            fromId,
            vaultSettingsIdentityListPatch(
              baseline,
              renamedIdentity.id,
              renamedIdentity.displayName,
            ),
          );
        }
        if (generation !== sectionBusyGenRef.current) return;
        failure = t(desktopErrorI18nKey(error, "error.settings_save_failed"));
        if (showing()) showError(error, "error.settings_save_failed");
        else notice(failure);
      } finally {
        onPersistBusyChange?.(null);
        submitInFlightRef.current = false;
        renameCommittedRef.current = false;
        if (generation === sectionBusyGenRef.current) {
          setSectionBusy(false);
          const savedId = renamedIdentity?.id ?? fromId;
          setPendingSave(
            failure ? { vaultId: savedId, area: "preferences", config: toSave, failure } : null,
          );
        }
      }
    },
    [
      vaultId,
      baseline,
      vault,
      pipelineListStatus,
      replaceConfig,
      onVaultSettingsSaved,
      onPersistBusyChange,
      notice,
      showError,
      show,
      t,
      vaultService,
      flashSaved,
      appSettings.backups,
    ],
  );

  const persistGroupAssignment = useCallback(async () => {
    if (!vaultId || !groupDirty) return;
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    const generation = (sectionBusyGenRef.current += 1);
    setSectionBusy(true);
    const forId = vaultId;
    const name = vault?.displayName ?? forId;
    setPendingSave({ vaultId: forId, area: "group", config: null, failure: null });
    let failure: string | null = null;
    const showing = () => openRef.current && vaultIdRef.current === forId;
    try {
      const assignment: CreateVaultGroupAssignment = pendingGroupName
        ? { kind: "create", displayName: pendingGroupName }
        : selectedGroupId
          ? { kind: "existing", groupId: selectedGroupId }
          : { kind: "none" };
      const nextSelectedId = selectedGroupIdAfterAssignment(
        assignment,
        groupsRef.current.map((group) => group.id),
      );
      await onCommitGroupAssignment?.(forId, assignment);
      if (generation !== sectionBusyGenRef.current) return;
      if (!showing()) {
        notice(t("toast.settings_saved_for", { name }));
        return;
      }
      setNewGroupName("");
      setSelectedGroupId(nextSelectedId);
      if (nextSelectedId && isHiddenGroup(groupsRef.current, nextSelectedId)) {
        lockDraftHidden();
      }
      flashSaved();
      setSaveConfirmOpen(false);
    } catch (error) {
      if (generation !== sectionBusyGenRef.current) return;
      failure = t(desktopErrorI18nKey(error, "error.settings_save_failed"));
      if (showing()) showError(error, "error.settings_save_failed");
      else notice(failure);
    } finally {
      submitInFlightRef.current = false;
      if (generation === sectionBusyGenRef.current) {
        setSectionBusy(false);
        setPendingSave(failure ? { vaultId: forId, area: "group", config: null, failure } : null);
      }
    }
  }, [
    vaultId,
    vault?.displayName,
    groupDirty,
    pendingGroupName,
    selectedGroupId,
    onCommitGroupAssignment,
    notice,
    showError,
    t,
    flashSaved,
    lockDraftHidden,
  ]);

  // The list owns the change and its toasts; the window keeps its form in step.
  useEffect(() => {
    if (!rewrapOutcome) return;
    const { vaultId: id, kind, error } = rewrapOutcome;
    if (error !== null) {
      const key = errorDisplayI18nKey(error);
      setRewrapFailure({
        vaultId: id,
        kind,
        message: t(key ?? "error.settings_save_failed"),
        onPasswordField: errorOnPasswordField(key),
      });
      return;
    }
    setRewrapFailure(null);
    const showing = openRef.current && vaultIdRef.current === id && areaRef.current === kind;
    if (!openRef.current || vaultIdRef.current === id) {
      if (kind === "password") resetPasswordForm();
      else resetKdfForm();
    }
    if (!showing) return;
    flashSaved();
    setSaveConfirmOpen(false);
    // The new unlock preset reaches the window through the list row.
    if (kind === "kdf") return;
    void vaultService
      .getSettings(id)
      .then((fresh) => {
        if (!fresh || !openRef.current || vaultIdRef.current !== id) return;
        const normalized = normalizeVaultSettingsConfig(fresh);
        replaceConfig(normalized);
        setDraft((current) =>
          current
            ? {
                ...current,
                security: {
                  ...current.security,
                  password_changed_at: normalized.security.password_changed_at,
                },
              }
            : current,
        );
      })
      .catch(() => {
        // The password already changed. A settings refresh must not hide that.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- each outcome applies once
  }, [rewrapOutcome]);

  const submitPasswordChange = useCallback(() => {
    if (!vaultId || !passwordCanSubmit) return;
    if (passwordFields.newPassword !== passwordFields.confirmPassword) {
      setPasswordError(t(createVaultErrorI18nKey("password_mismatch")));
      return;
    }
    const started = onChangePassword?.(
      vaultId,
      passwordFields.currentPassword,
      passwordFields.newPassword,
    );
    if (!started) {
      notice(t("vault.rewrap.busy"));
      return;
    }
    setRewrapFailure(null);
    setPasswordError(null);
  }, [vaultId, passwordCanSubmit, passwordFields, onChangePassword, notice, t]);

  const submitKdfChange = useCallback(() => {
    if (!vaultId || !kdfFields || !kdfCanSubmit) return;
    if (!onChangeKdf?.(vaultId, kdfFields.password, kdfFields.nextPreset)) {
      notice(t("vault.rewrap.busy"));
      return;
    }
    setRewrapFailure(null);
    setKdfError(null);
  }, [vaultId, kdfFields, kdfCanSubmit, onChangeKdf, notice, t]);

  const submitLimit = useOperationLimit(sectionBusy);
  const settingsLoading = Boolean(open && vaultId && loading && !loadTimedOut);
  const loadLimit = useOperationLimit(settingsLoading);

  useEffect(() => {
    if (!loadLimit.timedOut || !settingsLoading) return;
    invalidateLoad();
    setLoadTimedOut(true);
  }, [loadLimit.timedOut, settingsLoading, invalidateLoad]);

  useEffect(() => {
    if (!submitLimit.timedOut) return;
    sectionBusyGenRef.current += 1;
    submitInFlightRef.current = false;
    setSectionBusy(false);
    setPendingSave(null);
    if (!renameCommittedRef.current) {
      notice(t("error.operation_timed_out"));
    }
  }, [submitLimit.timedOut, notice, t]);

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
  }, []);

  const formConfig = draft ?? config;
  if (open && vaultId && seededFor !== vaultId) {
    const migrating = identityMigratingRef.current && identityMigratingToRef.current === vaultId;
    if (!migrating) {
      // A save still running, or one that failed, shows its values again.
      const pending = pendingSave?.vaultId === vaultId ? pendingSave.config : null;
      draftTouchedRef.current = pending !== null;
      const remembered = pending ?? peekVaultSettings(vaultId);
      setDraft(remembered ? normalizeVaultSettingsConfig(remembered) : null);
    }
    setSeededFor(vaultId);
  }
  if (!open && seededFor !== null) {
    setSeededFor(null);
  }

  const patchDraft = useCallback(
    <S extends keyof VaultSettingsConfig>(section: S, patch: Partial<VaultSettingsConfig[S]>) => {
      draftTouchedRef.current = true;
      setDiscardConfirmOpen(false);
      setSaveConfirmOpen(false);
      setDraft((current) => {
        if (!current) return current;

        if (section === "storage" && "mode" in patch && typeof patch.mode === "string") {
          if (storageModeLocked) return current;
          return patchStorageMode(current, patch.mode as StorageMode);
        }
        if (section === "storage" && "plain_files" in patch && plainFilesLocked) return current;
        if (section === "vault" && "display_name" in patch && displayNameLocked) {
          return current;
        }
        if (section === "mount" && mountLocked) return current;

        return {
          ...current,
          [section]: { ...current[section], ...patch },
        };
      });
    },
    [storageModeLocked, plainFilesLocked, displayNameLocked, mountLocked],
  );

  const resetActiveAreaDraft = useCallback(() => {
    if (activeArea === "preferences") {
      if (baseline) setDraft(baseline);
    } else if (activeArea === "group") {
      setSelectedGroupId(baselineGroupId);
      setNewGroupName("");
    } else if (activeArea === "password") {
      resetPasswordForm();
    } else if (activeArea === "kdf") {
      resetKdfForm();
    }
  }, [activeArea, baseline, baselineGroupId, resetPasswordForm, resetKdfForm]);

  /** A save in flight keeps running; its outcome comes back as a list toast. */
  const handleCloseModal = () => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setDeleteOpen(false);
    setDeleteConfirm("");
    onClose();
  };

  const requestCloseModal = () => {
    // Values already being saved are not unsaved.
    if (sectionBusy) {
      handleCloseModal();
      return;
    }
    const matchingRewrap =
      (activeArea === "password" && passwordRewrapRunning) ||
      (activeArea === "kdf" && kdfRewrapRunning);
    if (matchingRewrap) {
      onClose();
      return;
    }
    if (discardConfirmOpen || saveConfirmOpen) {
      dismissFooterConfirm();
      return;
    }
    if (activeArea && areaDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    handleCloseModal();
  };

  const handleDiscardConfirmed = () => {
    if (sectionBusy) return;
    resetActiveAreaDraft();
    setDiscardConfirmOpen(false);
    handleCloseModal();
  };

  const handleSaveClick = () => {
    if (settingsSaveBlocked) return;
    if (
      !activeArea ||
      !areaDirty ||
      sectionBusy ||
      mountPathIssue ||
      mountDriverAttention ||
      backupFolderBlocking
    ) {
      return;
    }

    if (activeArea === "preferences" && draft) {
      const validation = validateDisplayName(draft.vault.display_name);
      if (validation) return;
    }
    if (activeArea === "group" && pendingGroupName) {
      const validation = validateDisplayName(pendingGroupName);
      if (validation) return;
    }
    dismissFooterConfirm();
    setSaveConfirmOpen(true);
  };

  const handleConfirmSave = () => {
    if (settingsSaveBlocked) return;
    if (!activeArea || sectionBusy) return;
    if (activeArea === "preferences") {
      if (
        !draft ||
        !preferencesDirty ||
        mountPathIssue ||
        mountDriverAttention ||
        backupFolderBlocking
      ) {
        return;
      }
      void persistPreferences(draft);
      return;
    }
    if (activeArea === "group") {
      void persistGroupAssignment();
      return;
    }
    if (activeArea === "password") {
      void submitPasswordChange();
      return;
    }
    if (activeArea === "kdf") {
      void submitKdfChange();
    }
  };

  const handleConfirmDelete = async () => {
    if (
      !canConfirmDelete ||
      !canDeleteNow ||
      !vault ||
      sectionBusy ||
      !vaultService.canDeleteVault
    ) {
      return;
    }
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    const generation = (sectionBusyGenRef.current += 1);
    setSectionBusy(true);
    try {
      await onVaultDelete?.(vault.id, removeOutsideBackups);
      if (generation !== sectionBusyGenRef.current) return;
      setDeleteOpen(false);
      setDeleteConfirm("");
      setRemoveOutsideBackups(false);
      if (openRef.current) handleCloseModal();
    } catch (error) {
      if (generation !== sectionBusyGenRef.current) return;
      showError(error, "error.settings_save_failed");
    } finally {
      if (generation === sectionBusyGenRef.current) {
        submitInFlightRef.current = false;
        setSectionBusy(false);
      }
    }
  };

  if (!open || !vault || !activeArea) return null;

  const modalTitle = t(vaultSettingsAreaTitleKey(activeArea));

  const rewrapHere =
    (activeArea === "password" && passwordRewrapRunning) ||
    (activeArea === "kdf" && kdfRewrapRunning);
  const failureForArea =
    rewrapFailure &&
    vaultId &&
    rewrapFailure.vaultId === vaultId &&
    rewrapFailure.kind === activeArea
      ? rewrapFailure
      : null;
  const passwordFieldError = failureForArea?.onPasswordField ? failureForArea.message : null;
  const rewrapFormError =
    failureForArea && !failureForArea.onPasswordField ? failureForArea.message : null;
  const pendingHere = pendingSave?.vaultId === vaultId && pendingSave.area === activeArea;
  /** The save in flight belongs to this vault and screen; otherwise it is another change. */
  const savingHere = pendingHere && pendingSave?.failure === null;
  const saveFailure = pendingHere ? (pendingSave?.failure ?? null) : null;

  const saveLabel =
    activeArea === "password"
      ? passwordRewrapRunning
        ? t("vault.change_password.submitting")
        : t("vault.change_password.submit")
      : activeArea === "kdf"
        ? kdfRewrapRunning
          ? t("vault.change_kdf.submitting")
          : t("vault.change_kdf.submit")
        : saveConfirmOpen
          ? t("modal.settings.save_confirm_action")
          : t("modal.settings.save");

  const saveDisabled =
    settingsSaveBlocked ||
    sectionBusy ||
    !areaDirty ||
    mountPathIssue ||
    mountDriverAttention ||
    backupFolderBlocking ||
    (activeArea === "preferences" && !vaultService.canPersistSettings) ||
    (activeArea === "password" && !passwordCanSubmit) ||
    (activeArea === "kdf" && !kdfCanSubmit);

  const confirmCopy =
    activeArea === "password"
      ? t("modal.settings.area.password_save_confirm")
      : activeArea === "kdf"
        ? t("modal.settings.area.kdf_save_confirm")
        : activeArea === "group"
          ? t("modal.settings.area.group_save_confirm")
          : t("modal.settings.save_confirm");

  const footer =
    activeArea === "group" || formConfig ? (
      <div className="flex flex-col gap-3">
        <div className="text-sm" aria-live="polite">
          {discardConfirmOpen ? (
            <p className="text-on-surface-variant">{t("modal.settings.discard_confirm")}</p>
          ) : saveConfirmOpen ? (
            <p className="text-on-surface-variant">{confirmCopy}</p>
          ) : savedVisible ? (
            <p className="text-vault-open">{t("modal.settings.saved")}</p>
          ) : rewrapHere && rewrapJob ? (
            <p className="flex items-baseline gap-2 text-on-surface-variant" role="status">
              <span>{rewrapJob.startedAt === null ? t("vault.status.queued") : saveLabel}</span>
              {rewrapJob.stoppingSince === null ? (
                <ElapsedTime startedAt={rewrapJob.startedAt} layout="inline" />
              ) : null}
            </p>
          ) : sectionBusy && pendingSave !== null && submitLimit.visible ? (
            <p className="text-on-surface-variant" role="status">
              {savingHere ? t("modal.settings.saving") : t("modal.settings.saving_other")}
            </p>
          ) : saveFailure ? (
            <p className="text-on-error-container" role="alert">
              {saveFailure}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row-reverse sm:flex-wrap sm:justify-end [&_button]:w-full sm:[&_button]:w-auto">
            {discardConfirmOpen ? (
              <>
                <Button
                  variant="danger"
                  size="md"
                  disabled={sectionBusy}
                  onClick={handleDiscardConfirmed}
                >
                  {t("modal.settings.discard_confirm_action")}
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  disabled={sectionBusy}
                  onClick={dismissFooterConfirm}
                >
                  {t("modal.settings.discard_keep_editing")}
                </Button>
              </>
            ) : rewrapHere && rewrapJob ? (
              <JobStopButton
                stoppingSince={rewrapJob.stoppingSince}
                stoppable={rewrapJob.progress?.stoppable ?? true}
                onStop={() => onStopRewrap?.()}
              />
            ) : (
              <>
                <Button
                  variant="primary"
                  size="md"
                  disabled={saveDisabled}
                  onClick={saveConfirmOpen ? handleConfirmSave : handleSaveClick}
                >
                  {saveLabel}
                </Button>
                {saveConfirmOpen ? (
                  <Button
                    variant="ghost"
                    size="md"
                    disabled={sectionBusy}
                    onClick={dismissFooterConfirm}
                  >
                    {t("modal.settings.save_cancel")}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    ) : undefined;

  return (
    <Modal
      open={open}
      title={modalTitle}
      titleIcon={VAULT_SETTINGS_AREA_ICON[activeArea]}
      contextTitle={vault.displayName}
      onClose={requestCloseModal}
      panelClassName="max-w-3xl"
      footer={footer}
    >
      <div
        className="space-y-1.5 sm:space-y-2"
        onPointerDown={() => {
          if (discardConfirmOpen || saveConfirmOpen) dismissFooterConfirm();
        }}
      >
        {activeArea === "group" ? (
          <div className="space-y-3">
            <VaultSettingsGroupSection
              groups={groups}
              includeHidden={showHiddenVaults}
              selectedGroupId={selectedGroupId}
              newGroupName={newGroupName}
              onSelectedGroupIdChange={(groupId) => {
                setSelectedGroupId(groupId);
                setNewGroupName("");
                dismissFooterConfirm();
              }}
              onNewGroupNameChange={(name) => {
                setNewGroupName(name);
                dismissFooterConfirm();
              }}
            />
          </div>
        ) : loadTimedOut ? (
          <div className="py-10 text-center text-sm text-on-surface-variant">
            <p role="alert">{t("loading.timed_out")}</p>
            <div className="mt-4 flex justify-center">
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  setLoadTimedOut(false);
                  retryLoad();
                }}
              >
                {t("action.retry")}
              </Button>
            </div>
          </div>
        ) : loadError && !formConfig ? (
          <div className="py-10 text-center text-sm text-on-surface-variant">
            <p role="alert">{t(desktopErrorI18nKey(loadError))}</p>
            <div className="mt-4 flex justify-center">
              <Button variant="primary" size="md" onClick={retryLoad}>
                {t("action.retry")}
              </Button>
            </div>
          </div>
        ) : formConfig ? (
          <>
            {activeArea === "preferences" ? (
              <>
                {vaultSettingsPreferenceSections(formConfig.storage.mode).map((sectionId) => (
                  <VaultSettingsSection
                    key={sectionId}
                    title={t(`modal.settings.section.${sectionId}` as I18nKey)}
                  >
                    {renderPreferenceSection(
                      sectionId,
                      formConfig,
                      patchDraft,
                      {
                        storageModeLocked,
                        plainFilesLocked,
                        displayNameLocked,
                        mountLocked,
                        hiddenLocked,
                        editHold,
                      },
                      vaultRootPathForWorkspaceValidation(
                        appSettings.app.vault_root_mode,
                        appSettings.app.upriv_root_path,
                        resolvedRootPath,
                      ),
                      setMountPathIssue,
                      setMountDriverAttention,
                      appSettings.workspace,
                      {
                        appBackups: appSettings.backups,
                        vaultId: vault.id,
                        saved: baseline?.backup ?? null,
                        onBlockingChange: setBackupFolderBlocking,
                      },
                    )}
                  </VaultSettingsSection>
                ))}

                <VaultSettingsSection title={t("modal.settings.danger_zone")} tone="danger">
                  <VaultSettingsDangerZoneSection
                    vaultId={vault.id}
                    deleteOpen={deleteOpen}
                    deleteConfirm={deleteConfirm}
                    confirmInputId={confirmInputId}
                    canConfirmDelete={canConfirmDelete}
                    onRequestDelete={() => {
                      setDeleteOpen(true);
                      setDeleteConfirm("");
                    }}
                    outsideBackups={vault.outsideBackups === true}
                    removeOutsideBackups={removeOutsideBackups}
                    onRemoveOutsideBackupsChange={setRemoveOutsideBackups}
                    onCancelDelete={() => {
                      setDeleteOpen(false);
                      setDeleteConfirm("");
                      setRemoveOutsideBackups(false);
                    }}
                    onConfirmDelete={() => {
                      void handleConfirmDelete();
                    }}
                    onConfirmChange={setDeleteConfirm}
                    busy={sectionBusy}
                    enabled={vaultService.canDeleteVault}
                    hold={deleteHold}
                  />
                </VaultSettingsSection>
              </>
            ) : activeArea === "password" ? (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  {t("modal.settings.change_password_help")}
                </p>
                <p className="text-xs leading-relaxed text-on-surface-variant">
                  {t("warning.password_change_backups")}
                </p>
                <VaultChangePasswordFields
                  fields={passwordFields}
                  weakness={passwordWeakness}
                  rewrapBlocked={rewrapBlocked && !passwordRewrapRunning}
                  busy={passwordRewrapRunning}
                  passwordFieldError={passwordFieldError}
                  onChange={(patch) => {
                    setPasswordFields((current) => ({ ...current, ...patch }));
                    setPasswordError(null);
                    setRewrapFailure((current) => {
                      if (!current || current.vaultId !== vaultId || current.kind !== "password") {
                        return current;
                      }
                      if (current.onPasswordField && patch.currentPassword === undefined) {
                        return current;
                      }
                      return null;
                    });
                    dismissFooterConfirm();
                  }}
                  error={rewrapFormError ?? passwordError}
                />
              </div>
            ) : activeArea === "kdf" && kdfFields && headerUnlockPreset !== undefined ? (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  {t("modal.settings.section.kdf_settings_intro")}
                </p>
                <VaultChangeKdfFields
                  currentPreset={headerUnlockPreset}
                  rewrapBlocked={rewrapBlocked && !kdfRewrapRunning}
                  busy={kdfRewrapRunning}
                  fields={kdfFields}
                  passwordFieldError={activeArea === "kdf" ? passwordFieldError : null}
                  onChange={(patch) => {
                    setKdfFields((current) => (current ? { ...current, ...patch } : current));
                    setKdfError(null);
                    setRewrapFailure((current) => {
                      if (!current || current.vaultId !== vaultId || current.kind !== "kdf") {
                        return current;
                      }
                      if (current.onPasswordField && patch.password === undefined) return current;
                      return null;
                    });
                    dismissFooterConfirm();
                  }}
                  error={rewrapFormError ?? kdfError}
                />
              </div>
            ) : activeArea === "kdf" ? (
              <p className="text-sm leading-relaxed text-on-surface-variant">
                {vault ? "—" : t("vault.list.loading")}
              </p>
            ) : null}
          </>
        ) : (
          <ContentSkeleton label={t("modal.info.loading")} />
        )}
      </div>
    </Modal>
  );
}

function renderPreferenceSection(
  sectionId: VaultSettingsSectionId,
  draft: VaultSettingsConfig,
  patchDraft: <S extends keyof VaultSettingsConfig>(
    section: S,
    patch: Partial<VaultSettingsConfig[S]>,
  ) => void,
  locks: {
    storageModeLocked: boolean;
    plainFilesLocked: boolean;
    displayNameLocked: boolean;
    mountLocked: boolean;
    hiddenLocked: boolean;
    editHold: VaultConfigEditHold;
  },
  vaultRootPath: string | null,
  onMountPathIssue: (invalid: boolean) => void,
  onDriverAttentionChange: (active: boolean) => void,
  appWorkspace: WorkspaceTable,
  backupFolder: {
    appBackups: BackupFolderTable;
    vaultId: string;
    saved: VaultBackupFolders | null;
    onBlockingChange: (blocking: boolean) => void;
  },
) {
  switch (sectionId) {
    case "vault":
      return (
        <VaultSettingsVaultSection
          config={draft.vault}
          hiddenLocked={locks.hiddenLocked}
          displayNameLocked={locks.displayNameLocked}
          editHold={locks.editHold}
          onChange={(patch) => patchDraft("vault", patch)}
          fileManager={draft.file_manager}
          onFileManagerChange={(patch) => patchDraft("file_manager", patch)}
        />
      );
    case "storage":
      return (
        <VaultSettingsStorageSection
          config={draft.storage}
          storageModeLocked={locks.storageModeLocked}
          plainFilesLocked={locks.plainFilesLocked}
          editHold={locks.editHold}
          onChange={(patch) => patchDraft("storage", patch)}
        />
      );
    case "mount":
      return (
        <VaultSettingsMountSection
          config={draft.mount}
          vaultRootPath={vaultRootPath}
          controlsDisabled={locks.mountLocked}
          editHold={locks.editHold}
          plaintext={draft.storage.mode === "upriv_plain"}
          appWorkspace={appWorkspace}
          onPathIssueChange={(issue) => onMountPathIssue(issue != null)}
          onDriverAttentionChange={onDriverAttentionChange}
          onChange={(patch) => patchDraft("mount", patch)}
        />
      );
    case "auto_close":
      return (
        <VaultSettingsCloseSection
          autoClose={draft.auto_close}
          onAutoCloseChange={(patch) => patchDraft("auto_close", patch)}
        />
      );
    case "backup":
      return (
        <VaultSettingsBackupSection
          config={draft.backup}
          onChange={(patch) => patchDraft("backup", patch)}
          appBackups={backupFolder.appBackups}
          vaultId={backupFolder.vaultId}
          vaultRootPath={vaultRootPath}
          saved={backupFolder.saved}
          onFolderBlockingChange={backupFolder.onBlockingChange}
        />
      );
    default:
      return null;
  }
}
