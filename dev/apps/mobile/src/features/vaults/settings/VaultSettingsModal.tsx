import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  changeKdfFormCanSubmit,
  DEFAULT_KDF_UNLOCK_PRESET,
  changeKdfFormIsDirty,
  changePasswordFormCanSubmit,
  changePasswordFormIsDirty,
  createVaultErrorI18nKey,
  errorDisplayI18nKey,
  errorOnPasswordField,
  displayNameErrorI18nKey,
  EMPTY_CHANGE_PASSWORD_FIELDS,
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
  vaultSettingsToListPatch,
  vaultSettingsIdentityListPatch,
  vaultRootPathForWorkspaceValidation,
  vaultConfigEditAllowed,
  vaultConfigEditHold,
  vaultDeleteHold,
  vaultRowControls,
  rebaseQuietLockedVaultSettings,
  normalizeStoredName,
  VAULT_DELETE_HOLD_I18N_KEY,
  type CreateVaultGroupAssignment,
  type ChangeKdfFieldsState,
  type ChangePasswordFieldsState,
  type StorageMode,
  type VaultGroup,
  type VaultListItem,
  type VaultPipelineListStatus,
  type VaultSettingsAreaId,
  type VaultSettingsConfig,
  type KdfUnlockPreset,
  type VaultRewrapKind,
} from "@upriv/shared";
import { useVaultRootService, useVaultService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import {
  Button,
  ContentSkeleton,
  ElapsedTime,
  JobStopButton,
  Modal,
  ModalFooterActions,
} from "@/components/ui";
import {
  useOperationLimit,
  type VaultRewrapJob,
  type VaultRewrapOutcome,
} from "@upriv/shared/react";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import {
  FieldHint,
  SettingsAccordionSection,
  VaultChangeKdfFields,
  VaultChangePasswordFields,
} from "@/components/settings";
import { ThemedInput } from "@/components/settings/settingsFields";
import { useAppSettingsContext } from "@/features/system/settings";
import { VaultSettingsForm, VaultSettingsGroupSection } from "./vaultSettingsForm";
import { useTapNotPan } from "@/components/ui/ScrimDismiss";

function cloneSettings(config: VaultSettingsConfig): VaultSettingsConfig {
  return JSON.parse(JSON.stringify(config)) as VaultSettingsConfig;
}

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
  /** List toast. A save can finish after this window closes. */
  showToast: (message: string) => void;
  /** The password or unlock-RAM change in flight; the list owns it. */
  rewrapJob?: VaultRewrapJob | null;
  /** How the last change ended, so the window resets its form or marks the field. */
  rewrapOutcome?: VaultRewrapOutcome | null;
  /** False while another change runs. */
  onChangePassword?: (vaultId: string, currentPassword: string, newPassword: string) => boolean;
  onChangeKdf?: (vaultId: string, currentPassword: string, nextPreset: KdfUnlockPreset) => boolean;
  onStopRewrap?: () => void;
  groups?: readonly VaultGroup[];
  onCommitGroupAssignment?: (
    vaultId: string,
    assignment: CreateVaultGroupAssignment,
  ) => Promise<void> | void;
  onVaultDelete?: (vaultId: string) => void;
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
  rewrapJob = null,
  rewrapOutcome = null,
  onChangePassword,
  onChangeKdf,
  onStopRewrap,
  groups = NO_VAULT_GROUPS,
  onCommitGroupAssignment,
  onVaultDelete,
}: VaultSettingsModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultService = useVaultService();
  const vaultRootService = useVaultRootService();
  const { settings: appSettings, showHiddenVaultsSession } = useAppSettingsContext();
  const vaultId = vault?.id ?? null;
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
  const rewrapBlocked = Boolean(
    vault && !vaultConfigEditAllowed("action.change_password", vault, pipelineListStatus),
  );
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
  const [passwordFields, setPasswordFields] = useState<ChangePasswordFieldsState>(
    EMPTY_CHANGE_PASSWORD_FIELDS,
  );
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [kdfFields, setKdfFields] = useState<ChangeKdfFieldsState | null>(null);
  const [kdfError, setKdfError] = useState<string | null>(null);
  const [rewrapFailure, setRewrapFailure] = useState<RewrapFailure | null>(null);
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
  const [headerUnlockPreset, setHeaderUnlockPreset] = useState<KdfUnlockPreset | undefined>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [mountPathIssue, setMountPathIssue] = useState(false);
  const [resolvedRootPath, setResolvedRootPath] = useState<string | null>(null);

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
      if (!rewrapJobRef.current && !rewrapFailureRef.current) {
        resetPasswordForm();
        resetKdfForm();
      }
      setDeleteOpen(false);
      setDeleteConfirm("");
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
  }, [open, vaultId, vaultService, loadAttempt, t, resetPasswordForm, resetKdfForm]);

  useEffect(() => {
    if (!open || !vaultId) return;
    const ownsForm =
      rewrapJobRef.current?.vaultId === vaultId || rewrapFailureRef.current?.vaultId === vaultId;
    if (ownsForm) return;
    resetPasswordForm();
    resetKdfForm();
  }, [open, resetKdfForm, resetPasswordForm, vaultId]);

  useEffect(() => {
    if (!loadLimit.timedOut) return;
    loadGen.current += 1;
    setLoadTimedOut(true);
  }, [loadLimit.timedOut]);

  useEffect(() => {
    if (!areaDirty) setSaveConfirmOpen(false);
  }, [areaDirty]);

  useEffect(() => () => clearTimeout(savedHideRef.current), []);

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

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
  }, []);
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
        await vaultService.registerSettings(toSave.vault.id, toSave);
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

  // The list owns the change and its toasts; the window keeps its form in step.
  useEffect(() => {
    if (!rewrapOutcome) return;
    const { vaultId: id, kind, error } = rewrapOutcome;
    if (error !== null) {
      setRewrapFailure({
        vaultId: id,
        kind,
        message: t(mobileErrorI18nKey(error, "error.settings_save_failed")),
        onPasswordField: errorOnPasswordField(errorDisplayI18nKey(error)),
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
    markSaved();
    setSaveConfirmOpen(false);
    // The new unlock preset reaches the window through the list row.
    if (kind === "kdf") return;
    void vaultService
      .getSettings(id)
      .then((fresh) => {
        if (!fresh || !openRef.current || vaultIdRef.current !== id) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- each outcome applies once
  }, [rewrapOutcome]);

  const submitPasswordChange = useCallback(() => {
    if (!vault || !passwordCanSubmit) return;
    if (passwordFields.newPassword !== passwordFields.confirmPassword) {
      setPasswordError(t(createVaultErrorI18nKey("password_mismatch")));
      return;
    }
    const started = onChangePassword?.(
      vault.id,
      passwordFields.currentPassword,
      passwordFields.newPassword,
    );
    if (!started) {
      showToast(t("vault.rewrap.busy"));
      return;
    }
    setRewrapFailure(null);
    setPasswordError(null);
  }, [vault, passwordCanSubmit, passwordFields, onChangePassword, showToast, t]);

  const submitKdfChange = useCallback(() => {
    if (!vault || !kdfFields || !kdfCanSubmit) return;
    if (!onChangeKdf?.(vault.id, kdfFields.password, kdfFields.nextPreset)) {
      showToast(t("vault.rewrap.busy"));
      return;
    }
    setRewrapFailure(null);
    setKdfError(null);
  }, [vault, kdfFields, kdfCanSubmit, onChangeKdf, showToast, t]);

  const resetActiveAreaDraft = useCallback(() => {
    if (activeArea === "preferences") {
      if (baseline) setDraft(cloneSettings(baseline));
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
  const handleCloseModal = useCallback(() => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setDeleteOpen(false);
    setDeleteConfirm("");
    onClose();
  }, [onClose]);

  const canConfirmDelete = vault !== null && deleteConfirm.trim() === vault.id;

  const handleConfirmDelete = useCallback(() => {
    if (!canConfirmDelete || !canDeleteNow || !vault || busy || !vaultService.canDeleteVault)
      return;
    onVaultDelete?.(vault.id);
    handleCloseModal();
  }, [
    canConfirmDelete,
    canDeleteNow,
    vault,
    busy,
    onVaultDelete,
    handleCloseModal,
    vaultService.canDeleteVault,
  ]);

  const requestCloseModal = () => {
    // Values already being saved are not unsaved.
    if (busy) {
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
    if (activeArea === "password") {
      submitPasswordChange();
      return;
    }
    if (activeArea === "kdf") {
      submitKdfChange();
    }
  };

  if (!open || !vault || !activeArea) return null;

  const modalTitle = t(vaultSettingsAreaTitleKey(activeArea));

  const rewrapHere =
    (activeArea === "password" && passwordRewrapRunning) ||
    (activeArea === "kdf" && kdfRewrapRunning);
  const failureForArea =
    rewrapFailure &&
    vault &&
    rewrapFailure.vaultId === vault.id &&
    rewrapFailure.kind === activeArea
      ? rewrapFailure
      : null;
  const passwordFieldError = failureForArea?.onPasswordField ? failureForArea.message : null;
  const rewrapFormError =
    failureForArea && !failureForArea.onPasswordField ? failureForArea.message : null;
  const pendingHere = pendingSave?.vaultId === vault.id && pendingSave.area === activeArea;
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
    busy ||
    !areaDirty ||
    mountPathIssue ||
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
        ) : rewrapHere && rewrapJob ? (
          <View style={styles.statusRow} accessibilityRole="text" accessibilityLiveRegion="polite">
            <Text style={typography.bodyMuted}>
              {rewrapJob.startedAt === null ? t("vault.status.queued") : saveLabel}
            </Text>
            {rewrapJob.stoppingSince === null ? (
              <ElapsedTime startedAt={rewrapJob.startedAt} layout="inline" />
            ) : null}
          </View>
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
      ) : rewrapHere && rewrapJob ? (
        <ModalFooterActions layout="confirm">
          <JobStopButton
            stoppingSince={rewrapJob.stoppingSince}
            stoppable={rewrapJob.progress?.stoppable ?? true}
            onStop={() => onStopRewrap?.()}
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
              storageModeLocked={storageModeLocked}
              plainFilesLocked={plainFilesLocked}
              displayNameLocked={displayNameLocked}
              mountLocked={mountLocked}
              editHold={editHold}
              vaultRootPath={vaultRootPathForWorkspaceValidation(
                appSettings.app.vault_root_mode,
                appSettings.app.upriv_root_path,
                resolvedRootPath,
              )}
              appWorkspace={appSettings.workspace}
              onPathIssueChange={(issue) => setMountPathIssue(issue != null)}
              hiddenLocked={hiddenLocked}
            >
              {onVaultDelete ? (
                <SettingsAccordionSection title={t("modal.settings.danger_zone")} tone="danger">
                  {!deleteOpen ? (
                    <View style={styles.section}>
                      <Text style={typography.bodyMuted}>
                        {t("modal.settings.danger_zone_help")}
                      </Text>
                      {deleteHold ? (
                        <Text style={typography.bodyMuted}>
                          {t(VAULT_DELETE_HOLD_I18N_KEY[deleteHold])}
                        </Text>
                      ) : null}
                      <Button
                        variant="danger"
                        size="sm"
                        label={t("modal.settings.delete_vault")}
                        disabled={!vaultService.canDeleteVault || !canDeleteNow}
                        onPress={() => {
                          setDeleteOpen(true);
                          setDeleteConfirm("");
                        }}
                      />
                    </View>
                  ) : (
                    <View style={styles.section}>
                      <Text style={typography.bodyMuted}>{t("modal.settings.delete_confirm")}</Text>
                      <Text style={typography.mono}>{vault.id}</Text>
                      <ThemedInput
                        value={deleteConfirm}
                        onChangeText={setDeleteConfirm}
                        autoFocus
                        autoComplete="off"
                        autoCorrect={false}
                        spellCheck={false}
                        mono
                      />
                      <ModalFooterActions layout="dialog">
                        <Button
                          variant="ghost"
                          size="sm"
                          label={t("action.cancel")}
                          onPress={() => {
                            setDeleteOpen(false);
                            setDeleteConfirm("");
                          }}
                        />
                        <Button
                          variant="danger"
                          size="sm"
                          label={t("action.delete")}
                          disabled={!canConfirmDelete || !canDeleteNow}
                          onPress={handleConfirmDelete}
                        />
                      </ModalFooterActions>
                    </View>
                  )}
                </SettingsAccordionSection>
              ) : null}
            </VaultSettingsForm>
          ) : activeArea === "password" ? (
            <View style={styles.section}>
              <FieldHint>{t("modal.settings.change_password_help")}</FieldHint>
              <FieldHint>{t("warning.password_change_backups")}</FieldHint>
              <VaultChangePasswordFields
                fields={passwordFields}
                rewrapBlocked={rewrapBlocked && !passwordRewrapRunning}
                busy={passwordRewrapRunning}
                passwordFieldError={passwordFieldError}
                onChange={(patch) => {
                  setPasswordFields((current) => ({ ...current, ...patch }));
                  setPasswordError(null);
                  setRewrapFailure((current) => {
                    if (!current || current.vaultId !== vault.id || current.kind !== "password") {
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
            </View>
          ) : activeArea === "kdf" && kdfFields && headerUnlockPreset !== undefined ? (
            <View style={styles.section}>
              <FieldHint>{t("modal.settings.section.kdf_settings_intro")}</FieldHint>
              <VaultChangeKdfFields
                currentPreset={headerUnlockPreset}
                rewrapBlocked={rewrapBlocked && !kdfRewrapRunning}
                busy={kdfRewrapRunning}
                fields={kdfFields}
                passwordFieldError={passwordFieldError}
                onChange={(patch) => {
                  setKdfFields((current) => (current ? { ...current, ...patch } : current));
                  setKdfError(null);
                  setRewrapFailure((current) => {
                    if (!current || current.vaultId !== vault.id || current.kind !== "kdf") {
                      return current;
                    }
                    if (current.onPasswordField && patch.password === undefined) return current;
                    return null;
                  });
                  dismissFooterConfirm();
                }}
                error={rewrapFormError ?? kdfError}
              />
            </View>
          ) : activeArea === "kdf" ? (
            <Text style={typography.bodyMuted}>{vault ? "—" : t("vault.list.loading")}</Text>
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
  statusRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
});
