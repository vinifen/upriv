import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ContentSkeleton,
  JobProgressBar,
  JobStopButton,
  Modal,
  PasswordInput,
} from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";
import { useErrorToast } from "@/hooks/useErrorToast";
import {
  useOperationLimit,
  usePasswordWeakness,
  type PasswordChangeJob,
  type PasswordChangeOutcome,
  type UnlockRamChangeJob,
  type UnlockRamChangeOutcome,
} from "@upriv/shared/react";
import { hereDevice, useDeviceInfo } from "@upriv/shared/react";
import { useDeviceService, useVaultService } from "@/platform/services";
import {
  SettingsField,
  settingsControlClass,
  settingsInvalidControlClass,
  VaultChangeKdfFields,
  VaultChangePasswordFields,
  VaultSettingsBackupSection,
  VaultSettingsCloseSection,
  VaultSettingsStorageSection,
  VaultSettingsUnlockedFolderSection,
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
  VaultPipelineListStatus,
  KdfUnlockPreset,
  AppSettingsConfig,
  HereDevice,
  KeyChangeReportLine,
} from "@upriv/shared";
import {
  VAULT_BACKUP_LIST,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  VAULT_UNLOCKED_LIST,
  isEmptyVaultListChanges,
  encryptedFolderUnchosen,
  listDraftBlocks,
  storageModeIsPlaintext,
  requireVaultConfigEditLockedI18nKey,
  vaultListChanges,
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
  VAULT_SETTINGS_MENU_ICON,
  vaultSettingsPreferenceSections,
  vaultSettingsToListPatch,
  vaultSettingsIdentityListPatch,
  vaultConfigEditAllowed,
  vaultConfigEditHold,
  vaultRowControls,
  rebaseQuietLockedVaultSettings,
  normalizeStoredName,
  formatBytes,
  jobStepCopy,
  passwordChangeReportLines,
  passwordChangeSpaceShort,
  unlockRamChangeReportLines,
} from "@upriv/shared";
import { createVaultErrorI18nKey, desktopErrorI18nKey } from "@/lib/errorMessages";

const SAVED_INDICATOR_MS = 1500;

/** The two screens whose work is a job: the password change (and Finish), and unlock RAM. */
type ChangeArea = "password" | "kdf";

/** How the last change of a screen failed, so its field or form shows it until edited. */
type ChangeFailure = {
  vaultId: string;
  area: ChangeArea;
  message: string;
  onPasswordField: boolean;
};

/** What the last change of a screen did, as lines the screen shows once it ends. */
type ChangeReport = {
  vaultId: string;
  area: ChangeArea;
  lines: string[];
};

/** The password screen changes the password, or finishes a change a crash left. */
type PasswordMode = "change" | "finish";

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
  /** List toast. A save or a change can finish after this modal closes. */
  onNotice?: (message: string) => void;
  /** The password change or Finish in flight; the list owns it. */
  passwordJob?: PasswordChangeJob | null;
  /** How the last password change or Finish ended. */
  passwordOutcome?: PasswordChangeOutcome | null;
  /** False while another change runs. */
  onChangePassword?: (
    vaultId: string,
    currentPassword: string,
    newPassword: string,
    backUpFirst: boolean,
  ) => boolean;
  onFinishPasswordChange?: (vaultId: string, password: string) => boolean;
  onStopPasswordChange?: () => void;
  /** The unlock-RAM change in flight; the list owns it. */
  unlockRamJob?: UnlockRamChangeJob | null;
  /** How the last unlock-RAM change ended. */
  unlockRamOutcome?: UnlockRamChangeOutcome | null;
  onChangeKdf?: (vaultId: string, currentPassword: string, nextPreset: KdfUnlockPreset) => boolean;
  onStopUnlockRamChange?: () => void;
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
  onNotice,
  passwordJob = null,
  passwordOutcome = null,
  onChangePassword,
  onFinishPasswordChange,
  onStopPasswordChange,
  unlockRamJob = null,
  unlockRamOutcome = null,
  onChangeKdf,
  onStopUnlockRamChange,
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
  const here = hereDevice(useDeviceInfo(useDeviceService()));
  const hereIdRef = useRef(here?.id ?? null);
  hereIdRef.current = here?.id ?? null;
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
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [passwordFields, setPasswordFields] = useState<ChangePasswordFieldsState>(
    EMPTY_CHANGE_PASSWORD_FIELDS,
  );
  const [passwordError, setPasswordError] = useState<string | null>(null);
  /** **Back up first**: on each time the window opens. */
  const [backUpFirst, setBackUpFirst] = useState(true);
  const [passwordMode, setPasswordMode] = useState<PasswordMode>("change");
  const [finishPassword, setFinishPassword] = useState("");
  const [kdfFields, setKdfFields] = useState<ChangeKdfFieldsState | null>(null);
  const [kdfError, setKdfError] = useState<string | null>(null);
  const [changeFailure, setChangeFailure] = useState<ChangeFailure | null>(null);
  const [changeReport, setChangeReport] = useState<ChangeReport | null>(null);
  const [headerUnlockPreset, setHeaderUnlockPreset] = useState<KdfUnlockPreset | undefined>();
  const [sectionBusy, setSectionBusy] = useState(false);
  /** Outlives closing the window: a save keeps running and its result still applies. */
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  /** Invalidates a submit that ran past `OPERATION_LIMIT_MS`. */
  const sectionBusyGenRef = useRef(0);
  /** Sync lock — React `sectionBusy` paints too late for double-click. */
  const submitInFlightRef = useRef(false);
  const passwordJobRef = useRef(passwordJob);
  passwordJobRef.current = passwordJob;
  const unlockRamJobRef = useRef(unlockRamJob);
  unlockRamJobRef.current = unlockRamJob;
  const changeFailureRef = useRef<ChangeFailure | null>(null);
  const openRef = useRef(open);
  const areaRef = useRef(activeArea);
  const vaultIdRef = useRef(vaultId);
  openRef.current = open;
  areaRef.current = activeArea;
  vaultIdRef.current = vaultId;
  changeFailureRef.current = changeFailure;

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

  const vaultListStatus = vault ? resolveVaultListStatus(vault, pipelineListStatus) : "closed";
  const settingsSaveBlocked = Boolean(
    vault && vaultRowControls(vault, pipelineListStatus).settingsSaveBlocked,
  );
  const editHold = vault ? vaultConfigEditHold(vault, pipelineListStatus) : {};
  const editAllowed = (target: Parameters<typeof vaultConfigEditAllowed>[0]) =>
    vault != null && vaultConfigEditAllowed(target, vault, pipelineListStatus);
  const storageModeLocked = !editAllowed("storage.mode");
  const plainFilesLocked = !editAllowed("storage.plain_files");
  const displayNameLocked = !editAllowed("vault.display_name");
  /** This device's unlocked folder group and the encrypted switch — `vault_quiet`. */
  const unlockedLocked = !editAllowed("unlocked_folder");
  /** The password change, Finish, and unlock RAM — `vault_closed`. */
  const changeBlocked = !editAllowed("action.change_password");

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

  const passwordDirty = useMemo(
    () =>
      passwordMode === "finish"
        ? finishPassword.length > 0
        : changePasswordFormIsDirty(passwordFields),
    [finishPassword, passwordFields, passwordMode],
  );

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

  const passwordRunning = passwordJob !== null && passwordJob.vaultId === vaultId;
  const kdfRunning = unlockRamJob !== null && unlockRamJob.vaultId === vaultId;

  const passwordCanSubmit =
    passwordMode === "finish"
      ? finishPassword.length > 0 && vaultListStatus === "closed" && !passwordRunning
      : changePasswordFormCanSubmit({
          ...passwordFields,
          vaultListStatus,
          submitting: passwordRunning,
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
      submitting: kdfRunning,
    });

  const resetPasswordForm = useCallback(() => {
    setPasswordFields(EMPTY_CHANGE_PASSWORD_FIELDS);
    setFinishPassword("");
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
      setSelectedGroupId("");
      setNewGroupName("");
      setBackUpFirst(true);
      setChangeReport(null);
      if (!passwordJobRef.current && !unlockRamJobRef.current && !changeFailureRef.current) {
        resetPasswordForm();
        resetKdfForm();
      }
      setLoadTimedOut(false);
    }
  }, [open, vaultId, resetPasswordForm, resetKdfForm]);

  useEffect(() => {
    if (!open || !vaultId) return;
    const ownsForm =
      passwordJobRef.current?.vaultId === vaultId ||
      unlockRamJobRef.current?.vaultId === vaultId ||
      changeFailureRef.current?.vaultId === vaultId;
    if (ownsForm) return;
    resetPasswordForm();
    resetKdfForm();
  }, [open, resetKdfForm, resetPasswordForm, vaultId]);

  // A change a crash left unfinished opens on Finish; a running change keeps its mode.
  const unfinishedChange = vault?.passwordChange === "unfinished";
  useEffect(() => {
    if (!open || activeArea !== "password") return;
    if (passwordJobRef.current?.vaultId === vaultId) {
      setPasswordMode(passwordJobRef.current.kind);
      return;
    }
    setPasswordMode(unfinishedChange ? "finish" : "change");
  }, [activeArea, open, unfinishedChange, vaultId]);

  useEffect(() => {
    if (!areaDirty) setSaveConfirmOpen(false);
  }, [areaDirty]);

  useEffect(() => {
    return () => clearTimeout(savedHideRef.current);
  }, []);

  useEffect(() => {
    if (activeArea !== "kdf") return;
    setKdfFields((current) => {
      if (current && (unlockRamJobRef.current || changeFailureRef.current?.area === "kdf")) {
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
          // This device's unlocked folder group keeps its rows while the vault is not quiet.
          const lists = vaultListChanges(baseline, toSave, hereIdRef.current, {
            unlockedHere: unlockedLocked,
          });
          const saved = await vaultService.registerSettings(toSave.vault.id, toSave, lists);
          for (const folder of saved.keptFolders) {
            notice(t("folder_list.toast.folder_kept", { path: folder }));
          }
          if (!isEmptyVaultListChanges(lists)) {
            // Core applied the change to the lists as the file held them: read them back.
            toSave = (await vaultService.getSettings(toSave.vault.id)) ?? toSave;
          }
        }
        onVaultSettingsSaved?.(fromId, vaultSettingsToListPatch(toSave));
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
      unlockedLocked,
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

  /** The lines a change that ended leaves in its screen, in the window's language. */
  const reportText = (lines: KeyChangeReportLine[] | null) =>
    lines ? lines.map((line) => t(line.key, line.params)) : null;

  /**
   * A change ended: the list owns it and its toast; the window keeps its
   * form in step, marks a refused password on its field, and shows what the
   * change did while it shows that screen.
   */
  const applyChangeOutcome = useCallback(
    (id: string, area: ChangeArea, outcome: { error: unknown; lines: string[] | null }) => {
      if (outcome.error !== null) {
        const space = passwordChangeSpaceShort(outcome.error);
        const key = errorDisplayI18nKey(outcome.error);
        setChangeFailure({
          vaultId: id,
          area,
          message: space
            ? t("vault.change_password.space_short", {
                needed: formatBytes(space.needed),
                available: formatBytes(space.available),
              })
            : t(key ?? "error.settings_save_failed"),
          onPasswordField: errorOnPasswordField(key),
        });
        return;
      }
      setChangeFailure(null);
      if (!openRef.current || vaultIdRef.current === id) {
        if (area === "password") resetPasswordForm();
        else resetKdfForm();
      }
      const showing = openRef.current && vaultIdRef.current === id && areaRef.current === area;
      if (!showing) return;
      setSaveConfirmOpen(false);
      setChangeReport(outcome.lines ? { vaultId: id, area, lines: outcome.lines } : null);
    },
    [resetKdfForm, resetPasswordForm, t],
  );

  useEffect(() => {
    if (!passwordOutcome) return;
    const { vaultId: id, result, error } = passwordOutcome;
    applyChangeOutcome(id, "password", {
      error,
      lines: reportText(passwordChangeReportLines(passwordOutcome)),
    });
    if (!result || !openRef.current || vaultIdRef.current !== id) return;
    // The change stamps `password_changed_at`; the window's copy follows.
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
  }, [passwordOutcome]);

  useEffect(() => {
    if (!unlockRamOutcome) return;
    // The new unlock preset reaches the window through the list row.
    applyChangeOutcome(unlockRamOutcome.vaultId, "kdf", {
      error: unlockRamOutcome.error,
      lines: reportText(unlockRamChangeReportLines(unlockRamOutcome)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- each outcome applies once
  }, [unlockRamOutcome]);

  const submitPasswordChange = useCallback(() => {
    if (!vaultId || !passwordCanSubmit) return;
    if (passwordMode === "finish") {
      if (!onFinishPasswordChange?.(vaultId, finishPassword)) {
        notice(t("vault.password_change.busy"));
        return;
      }
    } else {
      if (passwordFields.newPassword !== passwordFields.confirmPassword) {
        setPasswordError(t(createVaultErrorI18nKey("password_mismatch")));
        return;
      }
      const started = onChangePassword?.(
        vaultId,
        passwordFields.currentPassword,
        passwordFields.newPassword,
        backUpFirst,
      );
      if (!started) {
        notice(t("vault.password_change.busy"));
        return;
      }
    }
    setChangeFailure(null);
    setChangeReport(null);
    setPasswordError(null);
  }, [
    backUpFirst,
    finishPassword,
    notice,
    onChangePassword,
    onFinishPasswordChange,
    passwordCanSubmit,
    passwordFields,
    passwordMode,
    t,
    vaultId,
  ]);

  const submitKdfChange = useCallback(() => {
    if (!vaultId || !kdfFields || !kdfCanSubmit) return;
    if (!onChangeKdf?.(vaultId, kdfFields.password, kdfFields.nextPreset)) {
      notice(t("vault.unlock_ram_change.busy"));
      return;
    }
    setChangeFailure(null);
    setChangeReport(null);
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
        if (section === "unlocked_folder" && "encrypted" in patch && unlockedLocked) {
          return current;
        }

        return {
          ...current,
          [section]: { ...current[section], ...patch },
        };
      });
    },
    [storageModeLocked, plainFilesLocked, displayNameLocked, unlockedLocked],
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
    onClose();
  };

  const requestCloseModal = () => {
    // Values already being saved are not unsaved.
    if (sectionBusy) {
      handleCloseModal();
      return;
    }
    const jobHere =
      (activeArea === "password" && passwordRunning) || (activeArea === "kdf" && kdfRunning);
    if (jobHere) {
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

  const hereId = here?.id ?? null;
  /** The vault should get an unlocked folder on this device, and none is chosen. */
  const unlockedUnchosen = (config: VaultSettingsConfig) =>
    !storageModeIsPlaintext(config.storage.mode) &&
    encryptedFolderUnchosen(appSettings.unlocked_folders, config.unlocked_folder, here);
  /**
   * A row of a list misses its path, or names one it may not, or this draft
   * leaves the vault with no unlocked folder here. The app's own switch and
   * list never hold a vault's save.
   */
  const listsBlocked = Boolean(
    activeArea === "preferences" &&
    draft &&
    baseline &&
    ((unlockedUnchosen(draft) && !unlockedUnchosen(baseline)) ||
      listDraftBlocks(
        baseline.unlocked_folder.devices,
        draft.unlocked_folder.devices,
        VAULT_UNLOCKED_LIST,
        hereId,
      ) ||
      listDraftBlocks(baseline.backup.devices, draft.backup.devices, VAULT_BACKUP_LIST, hereId)),
  );

  const handleSaveClick = () => {
    if (settingsSaveBlocked) return;
    if (!activeArea || !areaDirty || sectionBusy || listsBlocked) return;

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
      if (!draft || !preferencesDirty || listsBlocked) return;
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

  if (!open || !vault || !activeArea) return null;

  const modalTitle = t(vaultSettingsAreaTitleKey(activeArea));

  /** The change this screen started, while it runs. */
  const changeJobHere =
    activeArea === "password" && passwordRunning
      ? passwordJob
      : activeArea === "kdf" && kdfRunning
        ? unlockRamJob
        : null;
  const failureForArea =
    changeFailure &&
    vaultId &&
    changeFailure.vaultId === vaultId &&
    changeFailure.area === activeArea
      ? changeFailure
      : null;
  const passwordFieldError = failureForArea?.onPasswordField ? failureForArea.message : null;
  const changeFormError =
    failureForArea && !failureForArea.onPasswordField ? failureForArea.message : null;
  const reportForArea =
    changeReport && changeReport.vaultId === vaultId && changeReport.area === activeArea
      ? changeReport.lines
      : null;
  const pendingHere = pendingSave?.vaultId === vaultId && pendingSave.area === activeArea;
  /** The save in flight belongs to this vault and screen; otherwise it is another change. */
  const savingHere = pendingHere && pendingSave?.failure === null;
  const saveFailure = pendingHere ? (pendingSave?.failure ?? null) : null;

  const finishing = activeArea === "password" && passwordMode === "finish";
  const saveLabel =
    activeArea === "password"
      ? finishing
        ? t(passwordRunning ? "vault.change_password.finishing" : "vault.change_password.finish")
        : t(passwordRunning ? "vault.change_password.submitting" : "vault.change_password.submit")
      : activeArea === "kdf"
        ? t(kdfRunning ? "vault.change_kdf.submitting" : "vault.change_kdf.submit")
        : saveConfirmOpen
          ? t("modal.settings.save_confirm_action")
          : t("modal.settings.save");

  const saveDisabled =
    settingsSaveBlocked ||
    sectionBusy ||
    !areaDirty ||
    listsBlocked ||
    (activeArea === "preferences" && !vaultService.canPersistSettings) ||
    (activeArea === "password" && !passwordCanSubmit) ||
    (activeArea === "kdf" && !kdfCanSubmit);

  const confirmCopy =
    activeArea === "password"
      ? t(
          finishing
            ? "modal.settings.area.password_finish_confirm"
            : "modal.settings.area.password_save_confirm",
        )
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
            ) : changeJobHere ? (
              <JobStopButton
                stoppingSince={changeJobHere.stoppingSince}
                stoppable={changeJobHere.progress?.stoppable ?? true}
                onStop={() =>
                  activeArea === "password" ? onStopPasswordChange?.() : onStopUnlockRamChange?.()
                }
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
      titleIcon={VAULT_SETTINGS_MENU_ICON[activeArea]}
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
                        hiddenLocked,
                        editHold,
                        unlockedLockedHint: unlockedLocked
                          ? t(requireVaultConfigEditLockedI18nKey("unlocked_folder", editHold))
                          : null,
                      },
                      {
                        app: appSettings,
                        saved: baseline ?? formConfig,
                        here,
                        vaultId: vault.id,
                      },
                    )}
                  </VaultSettingsSection>
                ))}
              </>
            ) : activeArea === "password" ? (
              <div className="space-y-3">
                {changeJobHere ? (
                  <JobProgressBar
                    progress={changeJobHere.progress}
                    startedAt={changeJobHere.startedAt}
                    label={modalTitle}
                    copy={jobStepCopy(changeJobHere.progress, "job.step.unlocking")}
                  />
                ) : null}
                <ChangeReportLines lines={reportForArea} />
                {unfinishedChange ? (
                  <div className="space-y-1 rounded-lg border border-outline-variant/40 p-3">
                    <p className="text-sm leading-relaxed text-on-surface">
                      {t("vault.change_password.unfinished")}
                    </p>
                    {!passwordRunning ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPasswordMode((mode) => (mode === "finish" ? "change" : "finish"));
                          setChangeFailure(null);
                          dismissFooterConfirm();
                        }}
                      >
                        {t(
                          passwordMode === "finish"
                            ? "vault.change_password.change_instead"
                            : "vault.change_password.finish_instead",
                        )}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {passwordMode === "finish" ? (
                  <>
                    <p className="text-sm leading-relaxed text-on-surface-variant">
                      {t("vault.change_password.finish_help")}
                    </p>
                    <SettingsField
                      label={t("vault.change_password.finish_password")}
                      disabled={changeBlocked || passwordRunning}
                    >
                      <PasswordInput
                        value={finishPassword}
                        disabled={changeBlocked || passwordRunning}
                        aria-invalid={passwordFieldError ? true : undefined}
                        onChange={(event) => {
                          setFinishPassword(event.target.value);
                          setChangeFailure(null);
                          dismissFooterConfirm();
                        }}
                        autoComplete="current-password"
                        inputClassName={[settingsControlClass, settingsInvalidControlClass].join(
                          " ",
                        )}
                      />
                      {passwordFieldError ? (
                        <p role="alert" className="text-xs text-on-error-container">
                          {passwordFieldError}
                        </p>
                      ) : null}
                    </SettingsField>
                    {changeFormError ? (
                      <p className="text-xs text-on-error-container">{changeFormError}</p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-relaxed text-on-surface-variant">
                      {t("modal.settings.change_password_help")}
                    </p>
                    <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-on-surface-variant">
                      <li>{t("vault.change_password.stop_note")}</li>
                      <li>{t("vault.change_password.crash_note")}</li>
                      <li>{t("vault.change_password.unreadable_note")}</li>
                      <li>{t("warning.password_change_backups")}</li>
                    </ul>
                    <VaultChangePasswordFields
                      fields={passwordFields}
                      weakness={passwordWeakness}
                      backUpFirst={backUpFirst}
                      onBackUpFirstChange={(on) => {
                        setBackUpFirst(on);
                        dismissFooterConfirm();
                      }}
                      blocked={changeBlocked && !passwordRunning}
                      busy={passwordRunning}
                      passwordFieldError={passwordFieldError}
                      onChange={(patch) => {
                        setPasswordFields((current) => ({ ...current, ...patch }));
                        setPasswordError(null);
                        setChangeFailure((current) => {
                          if (
                            !current ||
                            current.vaultId !== vaultId ||
                            current.area !== "password"
                          ) {
                            return current;
                          }
                          if (current.onPasswordField && patch.currentPassword === undefined) {
                            return current;
                          }
                          return null;
                        });
                        dismissFooterConfirm();
                      }}
                      error={changeFormError ?? passwordError}
                    />
                  </>
                )}
              </div>
            ) : activeArea === "kdf" && kdfFields && headerUnlockPreset !== undefined ? (
              <div className="space-y-3">
                {changeJobHere ? (
                  <>
                    <JobProgressBar
                      progress={changeJobHere.progress}
                      startedAt={changeJobHere.startedAt}
                      label={modalTitle}
                      copy={jobStepCopy(changeJobHere.progress, "job.step.unlocking")}
                    />
                    {changeJobHere.progress?.step === "updating_key_copies" ? (
                      <p className="text-xs leading-relaxed text-on-surface-variant">
                        {t("vault.change_kdf.key_copies_running")}
                      </p>
                    ) : null}
                  </>
                ) : null}
                <ChangeReportLines lines={reportForArea} />
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  {t("modal.settings.section.kdf_settings_intro")}
                </p>
                <VaultChangeKdfFields
                  currentPreset={headerUnlockPreset}
                  blocked={changeBlocked && !kdfRunning}
                  busy={kdfRunning}
                  fields={kdfFields}
                  passwordFieldError={passwordFieldError}
                  onChange={(patch) => {
                    setKdfFields((current) => (current ? { ...current, ...patch } : current));
                    setKdfError(null);
                    setChangeFailure((current) => {
                      if (!current || current.vaultId !== vaultId || current.area !== "kdf") {
                        return current;
                      }
                      if (current.onPasswordField && patch.password === undefined) return current;
                      return null;
                    });
                    dismissFooterConfirm();
                  }}
                  error={changeFormError ?? kdfError}
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

/** What the last change of this screen did, once it ended. */
function ChangeReportLines({ lines }: { lines: string[] | null }) {
  if (!lines || lines.length === 0) return null;
  return (
    <div className="space-y-1 rounded-lg bg-surface-container-high p-3" role="status">
      {lines.map((line) => (
        <p key={line} className="text-sm leading-relaxed text-on-surface">
          {line}
        </p>
      ))}
    </div>
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
    hiddenLocked: boolean;
    editHold: VaultConfigEditHold;
    /** Why this device's unlocked folder group cannot change now. */
    unlockedLockedHint: string | null;
  },
  lists: {
    app: AppSettingsConfig;
    /** The settings as loaded: a save sends the lists' change from here. */
    saved: VaultSettingsConfig;
    here: HereDevice | null;
    vaultId: string;
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
    case "unlocked_folder":
      return (
        <VaultSettingsUnlockedFolderSection
          config={draft.unlocked_folder}
          saved={lists.saved.unlocked_folder}
          here={lists.here}
          vaultId={lists.vaultId}
          appUnlocked={lists.app.unlocked_folders}
          plaintext={draft.storage.mode === "upriv_plain"}
          lockedHint={locks.unlockedLockedHint}
          onChange={(patch) => patchDraft("unlocked_folder", patch)}
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
          saved={lists.saved.backup.devices}
          here={lists.here}
          vaultId={lists.vaultId}
          appBackups={lists.app.backups}
          onChange={(patch) => patchDraft("backup", patch)}
        />
      );
    default:
      return null;
  }
}
