import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  vaultPublicText,
  displayNameErrorI18nKey,
  NO_VAULT_GROUPS,
  isVaultInHiddenGroup,
  isHiddenGroup,
  resolveVaultListStatus,
  selectedGroupIdAfterAssignment,
  normalizeVaultSettingsConfig,
  peekVaultSettings,
  vaultSettingsEqual,
  vaultSettingsEqualIgnoringIdentity,
  validateDisplayName,
  vaultSettingsAreaTitleKey,
  VAULT_SETTINGS_MENU_ICON,
  vaultSettingsToListPatch,
  vaultSettingsIdentityListPatch,
  vaultConfigEditAllowed,
  VAULT_BACKUP_LIST,
  VAULT_UNLOCKED_LIST,
  isEmptyVaultListChanges,
  listDraftBlocks,
  requireVaultConfigEditLockedI18nKey,
  vaultListChanges,
  vaultConfigEditHold,
  vaultRowControls,
  rebaseQuietLockedVaultSettings,
  normalizeStoredName,
  jobStepCopy,
  type CreateVaultGroupAssignment,
  type VaultGroup,
  type VaultListItem,
  type VaultPipelineListStatus,
  type VaultSettingsAreaId,
  type VaultSettingsConfig,
  type VaultStorage,
  type KdfUnlockPreset,
} from "@upriv/shared";
import { hereDevice, useDeviceInfo } from "@upriv/shared/react";
import { useDeviceService, useVaultService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import {
  Button,
  ContentSkeleton,
  JobProgressBar,
  JobStopButton,
  Modal,
  ModalFooterActions,
} from "@/components/ui";
import {
  useOperationLimit,
  usePasswordWeakness,
  useVaultChangeScreens,
  type PasswordChangeJob,
  type PasswordChangeOutcome,
  type StorageChangeJob,
  type StorageChangeOutcome,
  type UnlockRamChangeJob,
  type UnlockRamChangeOutcome,
  type VaultChangeMade,
} from "@upriv/shared/react";
import { useTheme } from "@/theme";
import { radii, spacing } from "@/theme/tokens";
import {
  FieldHint,
  FieldLabel,
  PasswordInput,
  VaultChangeKdfFields,
  VaultChangePasswordFields,
} from "@/components/settings";
import { useAppSettingsContext } from "@/features/system/settings";
import { VaultChangeStorageFields } from "./VaultChangeStorageFields";
import { VaultSettingsForm, VaultSettingsGroupSection } from "./vaultSettingsForm";
import { useTapNotPan } from "@/components/ui/ScrimDismiss";

function cloneSettings(config: VaultSettingsConfig): VaultSettingsConfig {
  return JSON.parse(JSON.stringify(config)) as VaultSettingsConfig;
}

/** A Save still in flight, or one that failed, which the window shows again on reopen. */
type PendingSave = {
  vaultId: string;
  area: VaultSettingsAreaId;
  /** The values being saved, or the ones that did not save. */
  config: VaultSettingsConfig | null;
  /** `null` while it runs; the error line once it failed. */
  failure: string | null;
};

const SAVED_INDICATOR_MS = 1500;

interface VaultSettingsModalProps {
  vault: VaultListItem | null;
  /** Which settings screen the gear menu opened. */
  area: VaultSettingsAreaId | null;
  open: boolean;
  onClose: () => void;
  /** List pipeline — blocks KDF/password/storage changes while open/opening/closing. */
  pipelineListStatus?: VaultPipelineListStatus;
  onSaved: (vaultId: string, patch: ReturnType<typeof vaultSettingsToListPatch>) => void;
  onPersistBusyChange?: (vaultIds: readonly string[] | null) => void;
  /** List toast. A save or a change can finish after this window closes. */
  showToast: (message: string) => void;
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
  /** The Storage change in flight; the list owns it. */
  storageJob?: StorageChangeJob | null;
  /** How the last Storage change ended. */
  storageOutcome?: StorageChangeOutcome | null;
  onChangeStorage?: (vaultId: string, password: string, storage: VaultStorage) => boolean;
  onStopStorageChange?: () => void;
  groups?: readonly VaultGroup[];
  onCommitGroupAssignment?: (
    vaultId: string,
    assignment: CreateVaultGroupAssignment,
  ) => Promise<void> | void;
}

export function VaultSettingsModal({
  vault,
  area,
  open,
  onClose,
  pipelineListStatus = {},
  onSaved,
  onPersistBusyChange,
  showToast,
  passwordJob = null,
  passwordOutcome = null,
  onChangePassword,
  onFinishPasswordChange,
  onStopPasswordChange,
  unlockRamJob = null,
  unlockRamOutcome = null,
  onChangeKdf,
  onStopUnlockRamChange,
  storageJob = null,
  storageOutcome = null,
  onChangeStorage,
  onStopStorageChange,
  groups = NO_VAULT_GROUPS,
  onCommitGroupAssignment,
}: VaultSettingsModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultService = useVaultService();
  const here = hereDevice(useDeviceInfo(useDeviceService()));
  const hereIdRef = useRef(here?.id ?? null);
  hereIdRef.current = here?.id ?? null;
  const { settings: appSettings, showHiddenVaultsSession } = useAppSettingsContext();
  const vaultId = vault?.id ?? null;
  const vaultListStatus = vault ? resolveVaultListStatus(vault, pipelineListStatus) : "closed";
  const settingsSaveBlocked = Boolean(
    vault && vaultRowControls(vault, pipelineListStatus).settingsSaveBlocked,
  );
  const editHold = vault ? vaultConfigEditHold(vault, pipelineListStatus) : {};
  const editAllowed = (target: Parameters<typeof vaultConfigEditAllowed>[0]) =>
    vault != null && vaultConfigEditAllowed(target, vault, pipelineListStatus);
  const displayNameLocked = !editAllowed("vault.display_name");
  /** This device's unlocked folder group and the encrypted switch — `vault_quiet`. */
  const unlockedLocked = !editAllowed("unlocked_folder");
  /** The password change, Finish, unlock RAM, and storage — `vault_closed`. */
  const changeBlocked = !editAllowed("action.change_password");
  const activeArea = open ? area : null;

  const [draft, setDraft] = useState<VaultSettingsConfig | null>(null);
  const [baseline, setBaseline] = useState<VaultSettingsConfig | null>(null);
  const [busy, setBusy] = useState(false);
  /** Outlives closing the window: a save keeps running and its result still applies. */
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  /** Invalidates a submit that ran past `OPERATION_LIMIT_MS`. */
  const busyGenRef = useRef(0);
  /** Sync lock — React `busy` paints too late for double-click. */
  const submitInFlightRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const showHiddenVaults = appSettings.ui.always_show_hidden_vaults || showHiddenVaultsSession;
  const hiddenLocked = Boolean(vault && isVaultInHiddenGroup(groups, vault.id));
  const lockDraftHidden = useCallback(() => {
    const withHidden = (current: VaultSettingsConfig | null) => {
      if (!current || current.vault.hidden) return current;
      return { ...current, vault: { ...current.vault, hidden: true } };
    };
    setDraft(withHidden);
    setBaseline(withHidden);
  }, []);

  useEffect(() => {
    if (!hiddenLocked) return;
    lockDraftHidden();
  }, [hiddenLocked, lockDraftHidden]);
  const openRef = useRef(open);
  const vaultIdRef = useRef(vaultId);
  openRef.current = open;
  vaultIdRef.current = vaultId;

  const loadGen = useRef(0);
  /** Draft object seeded from the last read. A different object means the user edited. */
  const settingsSeedRef = useRef<VaultSettingsConfig | null>(null);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const identityMigratingRef = useRef(false);
  const identityMigratingToRef = useRef<string | null>(null);
  const renameCommittedRef = useRef(false);

  if (open && vaultId && seededFor !== vaultId) {
    const migrating = identityMigratingRef.current && identityMigratingToRef.current === vaultId;
    if (!migrating) {
      const remembered = peekVaultSettings(vaultId);
      const seededBaseline = remembered
        ? cloneSettings(normalizeVaultSettingsConfig(remembered))
        : null;
      // A save still running, or one that failed, shows its values again.
      const pending = pendingSave?.vaultId === vaultId ? pendingSave.config : null;
      if (pending) {
        const shown = cloneSettings(normalizeVaultSettingsConfig(pending));
        // A seed other than the draft marks it edited, so the settings read keeps it.
        settingsSeedRef.current = cloneSettings(shown);
        setBaseline(seededBaseline);
        setDraft(shown);
      } else if (seededBaseline) {
        const shown = cloneSettings(seededBaseline);
        settingsSeedRef.current = shown;
        setBaseline(seededBaseline);
        setDraft(shown);
      } else {
        settingsSeedRef.current = null;
        setDraft(null);
        setBaseline(null);
      }
    }
    setSeededFor(vaultId);
  }
  if (!open && seededFor !== null) {
    setSeededFor(null);
  }

  const loading = Boolean(open && vaultId && !draft && !loadError && !loadTimedOut);
  const loadLimit = useOperationLimit(loading);

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

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
  }, []);

  /** A change made for this vault: the window's copy of its settings follows. */
  const followChange = (change: VaultChangeMade) => {
    if (change.area === "storage") {
      const follow = (current: VaultSettingsConfig | null) =>
        current ? { ...current, storage: change.storage } : current;
      setBaseline(follow);
      setDraft(follow);
      return;
    }
    // The change stamps `password_changed_at`.
    void vaultService
      .getSettings(change.vaultId)
      .then((fresh) => {
        if (!fresh || !openRef.current || vaultIdRef.current !== change.vaultId) return;
        const normalized = cloneSettings(normalizeVaultSettingsConfig(fresh));
        setBaseline(normalized);
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
  };

  const changes = useVaultChangeScreens({
    open,
    vaultId,
    area,
    vaultListStatus,
    // The list row already read `header/vault.header`; unknown is not 256 MiB.
    unlockPreset: vault?.unlockPreset,
    storage: baseline?.storage ?? null,
    passwordChangeUnfinished: vault?.passwordChange === "unfinished",
    passwordChange: {
      job: passwordJob,
      outcome: passwordOutcome,
      change: onChangePassword,
      finish: onFinishPasswordChange,
      stop: onStopPasswordChange,
    },
    unlockRamChange: {
      job: unlockRamJob,
      outcome: unlockRamOutcome,
      change: onChangeKdf,
      stop: onStopUnlockRamChange,
    },
    storageChange: {
      job: storageJob,
      outcome: storageOutcome,
      change: onChangeStorage,
      stop: onStopStorageChange,
    },
    t,
    errorKey: (error) => mobileErrorI18nKey(error, "error.settings_save_failed"),
    notice: showToast,
    dismissConfirm: dismissFooterConfirm,
    onChanged: followChange,
  });
  const { password: passwordScreen, kdf: kdfScreen, storage: storageScreen } = changes;

  const areaDirty =
    activeArea === "preferences"
      ? preferencesDirty
      : activeArea === "group"
        ? groupDirty
        : (changes.active?.dirty ?? false);

  const vaultText = useMemo(
    () =>
      vaultPublicText({
        displayName: vault?.displayName ?? "",
        passwordHint: baseline?.vault.password_hint ?? "",
        note: baseline?.vault.note ?? "",
      }),
    [vault?.displayName, baseline?.vault.password_hint, baseline?.vault.note],
  );
  const passwordWeakness = usePasswordWeakness(
    passwordScreen.fields.newPassword,
    vaultText,
    passwordScreen.fields.currentPassword,
  );

  const reload = useCallback(() => {
    setLoadAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!open || !vaultId) {
      identityMigratingRef.current = false;
      identityMigratingToRef.current = null;
      loadGen.current += 1;
      settingsSeedRef.current = null;
      setDraft(null);
      setBaseline(null);
      setLoadError(null);
      setLoadTimedOut(false);
      setSaveConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
      setSelectedGroupId("");
      setNewGroupName("");
      return;
    }

    if (identityMigratingRef.current) {
      const skip = identityMigratingToRef.current === vaultId;
      identityMigratingRef.current = false;
      identityMigratingToRef.current = null;
      if (skip) return;
    }

    let cancelled = false;
    const gen = ++loadGen.current;
    setLoadError(null);
    setLoadTimedOut(false);
    setSelectedGroupId(
      groupsRef.current.find((group) => group.groupedVaults.includes(vaultId))?.id ?? "",
    );
    setNewGroupName("");
    const apply = (settings: VaultSettingsConfig) => {
      const normalized = cloneSettings(normalizeVaultSettingsConfig(settings));
      setBaseline(cloneSettings(normalized));
      setDraft((current) => {
        if (settingsSeedRef.current && current && current !== settingsSeedRef.current) {
          return current;
        }
        const next = cloneSettings(normalized);
        settingsSeedRef.current = next;
        return next;
      });
    };

    void vaultService
      .getSettings(vaultId)
      .then((settings) => {
        if (cancelled || gen !== loadGen.current) return;
        if (!settings) {
          setLoadError(t("error.unexpected"));
          return;
        }
        apply(settings);
      })
      .catch((caught) => {
        if (cancelled || gen !== loadGen.current) return;
        setLoadError(t(mobileErrorI18nKey(caught)));
      });

    return () => {
      cancelled = true;
    };
  }, [open, vaultId, vaultService, loadAttempt, t]);

  useEffect(() => {
    if (!loadLimit.timedOut) return;
    loadGen.current += 1;
    setLoadTimedOut(true);
  }, [loadLimit.timedOut]);

  useEffect(() => {
    if (!areaDirty) setSaveConfirmOpen(false);
  }, [areaDirty]);

  useEffect(() => () => clearTimeout(savedHideRef.current), []);

  const dismissConfirmOnBodyTap = useTapNotPan(
    dismissFooterConfirm,
    discardConfirmOpen || saveConfirmOpen,
  );

  const patchDraft = useCallback(
    <S extends keyof VaultSettingsConfig>(section: S, patch: Partial<VaultSettingsConfig[S]>) => {
      setDiscardConfirmOpen(false);
      setSaveConfirmOpen(false);
      setPendingSave((current) =>
        current && current.failure !== null && current.vaultId === vaultIdRef.current
          ? null
          : current,
      );
      setDraft((current) => {
        if (!current) return current;

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
    [displayNameLocked, unlockedLocked],
  );

  const submitLimit = useOperationLimit(busy);

  useEffect(() => {
    if (!submitLimit.timedOut) return;
    busyGenRef.current += 1;
    submitInFlightRef.current = false;
    setBusy(false);
    setPendingSave(null);
    if (!renameCommittedRef.current) {
      showToast(t("error.operation_timed_out"));
    }
  }, [submitLimit.timedOut, showToast, t]);

  const markSaved = useCallback(() => {
    setSavedVisible(true);
    clearTimeout(savedHideRef.current);
    savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
  }, []);

  const flashSaved = useCallback(() => {
    showToast(t("modal.settings.saved"));
    markSaved();
  }, [markSaved, showToast, t]);

  const persistPreferences = useCallback(async () => {
    if (
      !vault ||
      !draft ||
      busy ||
      !preferencesDirty ||
      !baseline ||
      !vaultService.canPersistSettings
    )
      return;
    if (vaultRowControls(vault, pipelineListStatus).settingsSaveBlocked) return;
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    const generation = (busyGenRef.current += 1);
    setBusy(true);
    const fromId = vault.id;
    const rebased = rebaseQuietLockedVaultSettings(draft, baseline, vault, pipelineListStatus);
    const normalized = normalizeVaultSettingsConfig(rebased);
    const locked = isVaultInHiddenGroup(groupsRef.current, fromId);
    let toSave =
      locked && !normalized.vault.hidden
        ? { ...normalized, vault: { ...normalized.vault, hidden: true } }
        : normalized;
    setPendingSave({ vaultId: fromId, area: "preferences", config: toSave, failure: null });
    let failure: string | null = null;
    let renamedIdentity: { id: string; displayName: string } | null = null;
    renameCommittedRef.current = false;
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
          failure = t(
            displayNameErrorI18nKey(validation),
            validation === "too_long" ? { max: String(VAULT_DISPLAY_NAME_MAX_LENGTH) } : undefined,
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
        const stale = generation !== busyGenRef.current;
        if (stale) {
          onSaved(
            fromId,
            vaultSettingsIdentityListPatch(baseline, renamed.id, renamed.displayName),
          );
          return;
        }
        if (showing()) {
          if (renamed.id !== fromId) {
            identityMigratingRef.current = true;
            identityMigratingToRef.current = renamed.id;
          }
          setBaseline({
            ...baseline,
            vault: {
              ...baseline.vault,
              id: renamed.id,
              display_name: renamed.displayName,
            },
          });
          setDraft(toSave);
        }
        if (renamed.id !== fromId) onPersistBusyChange?.([fromId, renamed.id]);
      }
      const otherDirty = !vaultSettingsEqualIgnoringIdentity(baseline, toSave);
      if (!nameDirty && !otherDirty) {
        if (generation !== busyGenRef.current) return;
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
          showToast(t("folder_list.toast.folder_kept", { path: folder }));
        }
        if (!isEmptyVaultListChanges(lists)) {
          // Core applied the change to the lists as the file held them: read them back.
          toSave = (await vaultService.getSettings(toSave.vault.id)) ?? toSave;
        }
      }
      onSaved(fromId, vaultSettingsToListPatch(toSave));
      if (generation !== busyGenRef.current) return;
      if (!showing()) {
        showToast(t("toast.settings_saved_for", { name: toSave.vault.display_name }));
        return;
      }
      setBaseline(toSave);
      setDraft(toSave);
      flashSaved();
      setSaveConfirmOpen(false);
    } catch (caught) {
      if (renamedIdentity) {
        onSaved(
          fromId,
          vaultSettingsIdentityListPatch(baseline, renamedIdentity.id, renamedIdentity.displayName),
        );
      }
      if (generation !== busyGenRef.current) return;
      failure = t(mobileErrorI18nKey(caught, "error.settings_save_failed"));
      if (!showing()) showToast(failure);
    } finally {
      onPersistBusyChange?.(null);
      submitInFlightRef.current = false;
      renameCommittedRef.current = false;
      if (generation === busyGenRef.current) {
        setBusy(false);
        const savedId = renamedIdentity?.id ?? fromId;
        setPendingSave(
          failure ? { vaultId: savedId, area: "preferences", config: toSave, failure } : null,
        );
      }
    }
  }, [
    vault,
    draft,
    busy,
    preferencesDirty,
    baseline,
    pipelineListStatus,
    vaultService,
    onSaved,
    onPersistBusyChange,
    flashSaved,
    showToast,
    t,
    unlockedLocked,
  ]);

  const persistGroupAssignment = useCallback(async () => {
    if (!vault || busy || !groupDirty) return;
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    const generation = (busyGenRef.current += 1);
    setBusy(true);
    const forId = vault.id;
    const name = vault.displayName;
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
      if (generation !== busyGenRef.current) return;
      if (!showing()) {
        showToast(t("toast.settings_saved_for", { name }));
        return;
      }
      setNewGroupName("");
      setSelectedGroupId(nextSelectedId);
      if (nextSelectedId && isHiddenGroup(groupsRef.current, nextSelectedId)) {
        lockDraftHidden();
      }
      flashSaved();
      setSaveConfirmOpen(false);
    } catch (caught) {
      if (generation !== busyGenRef.current) return;
      failure = t(mobileErrorI18nKey(caught, "error.settings_save_failed"));
      if (!showing()) showToast(failure);
    } finally {
      submitInFlightRef.current = false;
      if (generation === busyGenRef.current) {
        setBusy(false);
        setPendingSave(failure ? { vaultId: forId, area: "group", config: null, failure } : null);
      }
    }
  }, [
    vault,
    busy,
    groupDirty,
    pendingGroupName,
    selectedGroupId,
    onCommitGroupAssignment,
    flashSaved,
    lockDraftHidden,
    showToast,
    t,
  ]);

  const resetActiveAreaDraft = () => {
    if (activeArea === "preferences") {
      if (baseline) setDraft(cloneSettings(baseline));
    } else if (activeArea === "group") {
      setSelectedGroupId(baselineGroupId);
      setNewGroupName("");
    } else {
      changes.active?.reset();
    }
  };

  /** A save in flight keeps running; its outcome comes back as a list toast. */
  const handleCloseModal = useCallback(() => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  }, [onClose]);

  const requestCloseModal = () => {
    // Values already being saved are not unsaved.
    if (busy) {
      handleCloseModal();
      return;
    }
    // A change running here goes on after the window closes.
    if (changes.active?.job) {
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
    if (busy) return;
    resetActiveAreaDraft();
    setDiscardConfirmOpen(false);
    handleCloseModal();
  };

  const handleSaveClick = () => {
    if (settingsSaveBlocked) return;
    if (!activeArea || !areaDirty || busy) return;
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
    if (!activeArea || busy) return;
    if (activeArea === "preferences") {
      void persistPreferences();
      return;
    }
    if (activeArea === "group") {
      void persistGroupAssignment();
      return;
    }
    changes.active?.submit();
  };

  if (!open || !vault || !activeArea) return null;

  const modalTitle = t(vaultSettingsAreaTitleKey(activeArea));

  const changeScreen = changes.active;
  /** The change this screen started, while it runs. */
  const changeJobHere = changeScreen?.job ?? null;
  const pendingHere = pendingSave?.vaultId === vault.id && pendingSave.area === activeArea;
  /** The save in flight belongs to this vault and screen; otherwise it is another change. */
  const savingHere = pendingHere && pendingSave?.failure === null;
  const saveFailure = pendingHere ? (pendingSave?.failure ?? null) : null;

  const saveLabel = changeScreen
    ? t(changeScreen.labelKey)
    : saveConfirmOpen
      ? t("modal.settings.save_confirm_action")
      : t("modal.settings.save");

  const hereId = here?.id ?? null;
  /** A row of a list misses its path, or names one it may not. */
  const listsBlocked = Boolean(
    activeArea === "preferences" &&
    draft &&
    baseline &&
    (listDraftBlocks(
      baseline.unlocked_folder.devices,
      draft.unlocked_folder.devices,
      VAULT_UNLOCKED_LIST,
      hereId,
    ) ||
      listDraftBlocks(baseline.backup.devices, draft.backup.devices, VAULT_BACKUP_LIST, hereId)),
  );

  const saveDisabled =
    settingsSaveBlocked ||
    busy ||
    !areaDirty ||
    listsBlocked ||
    (activeArea === "preferences" && !vaultService.canPersistSettings) ||
    (changeScreen !== null && !changeScreen.canSubmit);

  const confirmCopy = changeScreen
    ? t(changeScreen.confirmKey)
    : activeArea === "group"
      ? t("modal.settings.area.group_save_confirm")
      : t("modal.settings.save_confirm");

  const footer = (
    <View style={styles.footerCol}>
      <View>
        {discardConfirmOpen ? (
          <Text style={typography.bodyMuted}>{t("modal.settings.discard_confirm")}</Text>
        ) : saveConfirmOpen ? (
          <Text style={typography.bodyMuted}>{confirmCopy}</Text>
        ) : savedVisible ? (
          <Text style={[typography.body, { color: colors.vaultStatusOpen }]}>
            {t("modal.settings.saved")}
          </Text>
        ) : busy && submitLimit.visible ? (
          <Text style={typography.bodyMuted} accessibilityLiveRegion="polite">
            {savingHere ? t("modal.settings.saving") : t("modal.settings.saving_other")}
          </Text>
        ) : saveFailure ? (
          <Text
            style={[typography.caption, { color: colors.onErrorContainer }]}
            accessibilityRole="alert"
          >
            {saveFailure}
          </Text>
        ) : null}
      </View>
      {discardConfirmOpen ? (
        <ModalFooterActions layout="confirm">
          <Button
            variant="danger"
            size="md"
            label={t("modal.settings.discard_confirm_action")}
            disabled={busy}
            onPress={handleDiscardConfirmed}
          />
          <Button
            variant="ghost"
            size="md"
            label={t("modal.settings.discard_keep_editing")}
            disabled={busy}
            onPress={dismissFooterConfirm}
          />
        </ModalFooterActions>
      ) : changeScreen && changeJobHere ? (
        <ModalFooterActions layout="confirm">
          <JobStopButton
            stoppingSince={changeJobHere.stoppingSince}
            stoppable={changeJobHere.progress?.stoppable ?? true}
            onStop={changeScreen.stop}
          />
        </ModalFooterActions>
      ) : (
        <ModalFooterActions layout="confirm">
          <Button
            size="md"
            variant="primary"
            label={saveLabel}
            onPress={() => {
              if (saveConfirmOpen) handleConfirmSave();
              else handleSaveClick();
            }}
            disabled={saveDisabled}
            busy={busy}
          />
          {saveConfirmOpen ? (
            <Button
              size="md"
              variant="ghost"
              label={t("modal.settings.save_cancel")}
              disabled={busy}
              onPress={dismissFooterConfirm}
            />
          ) : null}
        </ModalFooterActions>
      )}
    </View>
  );

  const changeProgress = changeJobHere ? (
    <JobProgressBar
      progress={changeJobHere.progress}
      startedAt={changeJobHere.startedAt}
      label={modalTitle}
      copy={jobStepCopy(changeJobHere.progress, "job.step.unlocking")}
    />
  ) : null;

  const report = changeScreen?.report ?? null;
  const reportLines =
    report && report.length > 0 ? (
      <View
        style={[styles.report, { backgroundColor: colors.surfaceContainerHigh }]}
        accessibilityLiveRegion="polite"
      >
        {report.map((line) => (
          <Text key={line} style={[typography.body, { color: colors.onSurface }]}>
            {line}
          </Text>
        ))}
      </View>
    ) : null;

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
      <View style={styles.body} {...dismissConfirmOnBodyTap}>
        {activeArea === "group" ? (
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
        ) : loadTimedOut ? (
          <View style={styles.center}>
            <Text
              style={[typography.body, { color: colors.onErrorContainer }]}
              accessibilityRole="alert"
            >
              {t("loading.timed_out")}
            </Text>
            <Button label={t("action.retry")} variant="primary" onPress={reload} />
          </View>
        ) : loadError && !draft ? (
          <View style={styles.center}>
            <Text
              style={[typography.body, { color: colors.onErrorContainer }]}
              accessibilityRole="alert"
            >
              {loadError}
            </Text>
            <Button label={t("action.retry")} variant="primary" onPress={reload} />
          </View>
        ) : loading && loadLimit.visible ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : draft ? (
          activeArea === "preferences" ? (
            <VaultSettingsForm
              draft={draft}
              patchDraft={patchDraft}
              displayNameLocked={displayNameLocked}
              unlockedLockedHint={
                unlockedLocked
                  ? t(requireVaultConfigEditLockedI18nKey("unlocked_folder", editHold))
                  : null
              }
              editHold={editHold}
              lists={{
                app: appSettings,
                saved: {
                  unlocked: (baseline ?? draft).unlocked_folder.devices,
                  backups: (baseline ?? draft).backup.devices,
                },
                here,
                vaultId,
              }}
              hiddenLocked={hiddenLocked}
            />
          ) : activeArea === "password" ? (
            <View style={styles.section}>
              {changeProgress}
              {reportLines}
              {passwordScreen.unfinished ? (
                <View style={[styles.unfinished, { borderColor: colors.outlineVariant }]}>
                  <Text style={[typography.body, { color: colors.onSurface }]}>
                    {t("vault.change_password.unfinished")}
                  </Text>
                  {!passwordScreen.job ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      label={t(
                        passwordScreen.mode === "finish"
                          ? "vault.change_password.change_instead"
                          : "vault.change_password.finish_instead",
                      )}
                      onPress={passwordScreen.toggleMode}
                    />
                  ) : null}
                </View>
              ) : null}
              {passwordScreen.mode === "finish" ? (
                <>
                  <FieldHint>{t("vault.change_password.finish_help")}</FieldHint>
                  <FieldLabel disabled={changeBlocked || passwordScreen.job !== null}>
                    {t("vault.change_password.finish_password")}
                  </FieldLabel>
                  <PasswordInput
                    value={passwordScreen.finishPassword}
                    disabled={changeBlocked || passwordScreen.job !== null}
                    invalid={Boolean(passwordScreen.passwordFieldError)}
                    onChangeText={passwordScreen.editFinishPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {passwordScreen.passwordFieldError ? (
                    <Text
                      style={[typography.caption, { color: colors.onErrorContainer }]}
                      accessibilityRole="alert"
                    >
                      {passwordScreen.passwordFieldError}
                    </Text>
                  ) : null}
                  {passwordScreen.formError ? (
                    <Text style={[typography.caption, { color: colors.onErrorContainer }]}>
                      {passwordScreen.formError}
                    </Text>
                  ) : null}
                </>
              ) : (
                <>
                  <FieldHint>{t("modal.settings.change_password_help")}</FieldHint>
                  <FieldHint>{t("vault.change_password.stop_note")}</FieldHint>
                  <FieldHint>{t("vault.change_password.crash_note")}</FieldHint>
                  <FieldHint>{t("vault.change_password.unreadable_note")}</FieldHint>
                  <FieldHint>{t("warning.password_change_backups")}</FieldHint>
                  <VaultChangePasswordFields
                    fields={passwordScreen.fields}
                    weakness={passwordWeakness}
                    backUpFirst={passwordScreen.backUpFirst}
                    onBackUpFirstChange={passwordScreen.setBackUpFirst}
                    blocked={changeBlocked && passwordScreen.job === null}
                    busy={passwordScreen.job !== null}
                    passwordFieldError={passwordScreen.passwordFieldError}
                    onChange={passwordScreen.edit}
                    error={passwordScreen.formError}
                  />
                </>
              )}
            </View>
          ) : activeArea === "kdf" && kdfScreen.fields && kdfScreen.currentPreset !== undefined ? (
            <View style={styles.section}>
              {changeProgress}
              {changeJobHere?.progress?.step === "updating_key_copies" ? (
                <FieldHint>{t("vault.change_kdf.key_copies_running")}</FieldHint>
              ) : null}
              {reportLines}
              <FieldHint>{t("modal.settings.section.kdf_settings_intro")}</FieldHint>
              <VaultChangeKdfFields
                currentPreset={kdfScreen.currentPreset}
                blocked={changeBlocked && kdfScreen.job === null}
                busy={kdfScreen.job !== null}
                fields={kdfScreen.fields}
                passwordFieldError={kdfScreen.passwordFieldError}
                onChange={kdfScreen.edit}
                error={kdfScreen.formError}
              />
            </View>
          ) : activeArea === "kdf" ? (
            <Text style={typography.bodyMuted}>{vault ? "—" : t("vault.list.loading")}</Text>
          ) : activeArea === "storage" && storageScreen.fields && storageScreen.current ? (
            <View style={styles.section}>
              {changeProgress}
              {reportLines}
              <VaultChangeStorageFields
                vaultId={vault.id}
                current={storageScreen.current}
                blocked={changeBlocked && storageScreen.job === null}
                busy={storageScreen.job !== null}
                fields={storageScreen.fields}
                passwordFieldError={storageScreen.passwordFieldError}
                onChange={storageScreen.edit}
                error={storageScreen.formError}
              />
            </View>
          ) : null
        ) : (
          <ContentSkeleton label={t("modal.info.loading")} />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  section: { gap: spacing.md },
  center: {
    gap: spacing.md,
    alignItems: "center",
    paddingVertical: spacing.xl,
    minHeight: 160,
  },
  footerCol: { gap: spacing.sm },
  report: { gap: spacing.xs, borderRadius: radii.sm, padding: spacing.md },
  unfinished: {
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.md,
    alignItems: "flex-start",
  },
});
