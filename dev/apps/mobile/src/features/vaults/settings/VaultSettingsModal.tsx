import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  LOADING_BUDGET_MS,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  changeKdfFormCanSubmit,
  DEFAULT_KDF_UNLOCK_PRESET,
  changeKdfFormIsDirty,
  changePasswordFormCanSubmit,
  changePasswordFormIsDirty,
  createVaultErrorI18nKey,
  errorDisplayI18nKey,
  rewrapErrorOnPasswordField,
  displayNameErrorI18nKey,
  EMPTY_CHANGE_PASSWORD_FIELDS,
  NO_VAULT_GROUPS,
  isVaultInHiddenGroup,
  isHiddenGroup,
  canDeleteVaultNow,
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
  rebaseQuietLockedVaultSettings,
  normalizeStoredName,
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
} from "@upriv/shared";
import { useVaultRootService, useVaultSecurityService, useVaultService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import {
  Button,
  ContentSkeleton,
  LoadingBudgetHint,
  Modal,
  ModalFooterActions,
  modalFooterConfirmBtnStyle,
} from "@/components/ui";
import { useLoadingBudget } from "@upriv/shared/react";
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

type RewrapKind = "password" | "kdf";

type RewrapRun = { vaultId: string; kind: RewrapKind; startedAt: number };

type RewrapFailure = {
  vaultId: string;
  kind: RewrapKind;
  message: string;
  onPasswordField: boolean;
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
  showToast: (message: string) => void;
  /** Lets the list refuse a second password or unlock-RAM screen. */
  onRewrapRunChange?: (run: { vaultId: string; kind: RewrapKind } | null) => void;
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
  onRewrapRunChange,
  groups = NO_VAULT_GROUPS,
  onCommitGroupAssignment,
  onVaultDelete,
}: VaultSettingsModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const vaultService = useVaultService();
  const vaultSecurityService = useVaultSecurityService();
  const vaultRootService = useVaultRootService();
  const { settings: appSettings, showHiddenVaultsSession } = useAppSettingsContext();
  const vaultId = vault?.id ?? null;
  const vaultListStatus = vault ? resolveVaultListStatus(vault, pipelineListStatus) : "closed";
  const canDeleteNow = canDeleteVaultNow(vaultListStatus);
  const editAllowed = (target: Parameters<typeof vaultConfigEditAllowed>[0]) =>
    vault != null && vaultConfigEditAllowed(target, vault, pipelineListStatus);
  const storageModeLocked = !editAllowed("storage.mode");
  const displayNameLocked = !editAllowed("vault.display_name");
  const mountLocked = !editAllowed("mount.workspace_path");
  const securityModeLocked = !editAllowed("security.mode");
  const rewrapBlocked = Boolean(
    vault && !vaultConfigEditAllowed("action.change_password", vault, pipelineListStatus),
  );
  const activeArea = open ? area : null;

  const [draft, setDraft] = useState<VaultSettingsConfig | null>(null);
  const [baseline, setBaseline] = useState<VaultSettingsConfig | null>(null);
  const [busy, setBusy] = useState(false);
  /** Invalidates a submit whose loading budget already expired. */
  const busyGenRef = useRef(0);
  /** Sync lock — React `busy` paints too late for double-click. */
  const submitInFlightRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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
  const [rewrapRun, setRewrapRun] = useState<RewrapRun | null>(null);
  const [rewrapFailure, setRewrapFailure] = useState<RewrapFailure | null>(null);
  const rewrapGenRef = useRef(0);
  const rewrapRunRef = useRef<RewrapRun | null>(null);
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
      if (remembered) {
        const normalized = cloneSettings(normalizeVaultSettingsConfig(remembered));
        const shown = cloneSettings(normalized);
        settingsSeedRef.current = shown;
        setBaseline(normalized);
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
  const loadBudget = useLoadingBudget(loading, LOADING_BUDGET_MS.settingsLoad);

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

  const nameDirty = Boolean(
    draft &&
    baseline &&
    normalizeStoredName(draft.vault.display_name) !==
      normalizeStoredName(baseline.vault.display_name),
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

  const passwordRewrapRunning = rewrapRun?.vaultId === vaultId && rewrapRun.kind === "password";
  const kdfRewrapRunning = rewrapRun?.vaultId === vaultId && rewrapRun.kind === "kdf";

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
      setSaveError(null);
      setLoadTimedOut(false);
      setSaveConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
      setSelectedGroupId("");
      setNewGroupName("");
      if (!rewrapRunRef.current && !rewrapFailureRef.current) {
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
    setSaveError(null);
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
      rewrapRunRef.current?.vaultId === vaultId || rewrapFailureRef.current?.vaultId === vaultId;
    if (ownsForm) return;
    resetPasswordForm();
    resetKdfForm();
  }, [open, resetKdfForm, resetPasswordForm, vaultId]);

  useEffect(() => {
    if (!loadBudget.timedOut) return;
    loadGen.current += 1;
    setLoadTimedOut(true);
  }, [loadBudget.timedOut]);

  useEffect(() => {
    if (!areaDirty) setSaveConfirmOpen(false);
  }, [areaDirty]);

  useEffect(() => () => clearTimeout(savedHideRef.current), []);

  useEffect(() => {
    if (activeArea !== "kdf") return;
    setKdfFields((current) => {
      if (
        current &&
        (rewrapRunRef.current?.kind === "kdf" || rewrapFailureRef.current?.kind === "kdf")
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
      setSaveError(null);
      setDraft((current) => {
        if (!current) return current;

        if (section === "storage" && "mode" in patch && typeof patch.mode === "string") {
          if (storageModeLocked) return current;
          return patchStorageMode(current, patch.mode as StorageMode);
        }
        if (section === "vault" && "display_name" in patch && displayNameLocked) {
          return current;
        }
        if (section === "mount" && mountLocked) return current;
        if (section === "security" && "mode" in patch && securityModeLocked) {
          return current;
        }

        return {
          ...current,
          [section]: { ...current[section], ...patch },
        };
      });
    },
    [storageModeLocked, displayNameLocked, mountLocked, securityModeLocked],
  );

  const submitBudgetMs = nameDirty
    ? LOADING_BUDGET_MS.vaultRename
    : LOADING_BUDGET_MS.settingsSave;
  const submitBudget = useLoadingBudget(busy, submitBudgetMs);
  const rewrapBudget = useLoadingBudget(rewrapRun !== null, LOADING_BUDGET_MS.vaultRewrap, {
    startedAt: rewrapRun?.startedAt,
  });

  useEffect(() => {
    if (!submitBudget.timedOut) return;
    busyGenRef.current += 1;
    setBusy(false);
    if (!renameCommittedRef.current) {
      setSaveError(t("error.operation_timed_out"));
    }
  }, [submitBudget.timedOut, t]);

  useEffect(() => {
    if (!rewrapBudget.timedOut || rewrapRunRef.current === null) return;
    const id = rewrapRunRef.current.vaultId;
    rewrapGenRef.current += 1;
    rewrapRunRef.current = null;
    setRewrapRun(null);
    if (!openRef.current || vaultIdRef.current === id) {
      resetPasswordForm();
      resetKdfForm();
    }
    showToast(t("error.operation_timed_out"));
  }, [resetKdfForm, resetPasswordForm, rewrapBudget.timedOut, showToast, t]);

  useEffect(() => {
    onRewrapRunChange?.(rewrapRun ? { vaultId: rewrapRun.vaultId, kind: rewrapRun.kind } : null);
  }, [onRewrapRunChange, rewrapRun]);

  const flashSaved = useCallback(() => {
    showToast(t("modal.settings.saved"));
    setSavedVisible(true);
    clearTimeout(savedHideRef.current);
    savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
  }, [showToast, t]);

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
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    const generation = (busyGenRef.current += 1);
    setBusy(true);
    setSaveError(null);
    const fromId = vault.id;
    let renamedIdentity: { id: string; displayName: string } | null = null;
    renameCommittedRef.current = false;
    onPersistBusyChange?.([fromId]);
    try {
      const rebased = rebaseQuietLockedVaultSettings(draft, baseline, vault, pipelineListStatus);
      const normalized = normalizeVaultSettingsConfig(rebased);
      const locked = Boolean(vault && isVaultInHiddenGroup(groupsRef.current, vault.id));
      let toSave =
        locked && !normalized.vault.hidden
          ? { ...normalized, vault: { ...normalized.vault, hidden: true } }
          : normalized;
      const nameDirty =
        toSave.vault.display_name !== normalizeStoredName(baseline.vault.display_name);
      if (nameDirty) {
        const validation = validateDisplayName(toSave.vault.display_name);
        if (validation) {
          setSaveError(
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
        const stale = generation !== busyGenRef.current;
        if (!stale) {
          const identityBaseline = {
            ...baseline,
            vault: {
              ...baseline.vault,
              id: renamed.id,
              display_name: renamed.displayName,
            },
          };
          setBaseline(identityBaseline);
          setDraft(toSave);
        }
        if (stale) {
          onSaved(
            fromId,
            vaultSettingsIdentityListPatch(baseline, renamed.id, renamed.displayName),
          );
          return;
        }
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
      setSaveError(t(mobileErrorI18nKey(caught)));
    } finally {
      onPersistBusyChange?.(null);
      submitInFlightRef.current = false;
      renameCommittedRef.current = false;
      if (generation === busyGenRef.current) {
        setBusy(false);
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
    t,
  ]);

  const persistGroupAssignment = useCallback(async () => {
    if (!vault || busy || !groupDirty) return;
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    const generation = (busyGenRef.current += 1);
    setBusy(true);
    setSaveError(null);
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
      await onCommitGroupAssignment?.(vault.id, assignment);
      if (generation !== busyGenRef.current) return;
      setNewGroupName("");
      setSelectedGroupId(nextSelectedId);
      if (nextSelectedId && isHiddenGroup(groupsRef.current, nextSelectedId)) {
        lockDraftHidden();
      }
      flashSaved();
      setSaveConfirmOpen(false);
    } catch (caught) {
      if (generation !== busyGenRef.current) return;
      setSaveError(t(mobileErrorI18nKey(caught)));
    } finally {
      submitInFlightRef.current = false;
      if (generation === busyGenRef.current) {
        setBusy(false);
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
    t,
  ]);

  const beginRewrap = useCallback(
    (id: string, kind: RewrapKind): number | null => {
      if (rewrapRunRef.current) {
        showToast(t("vault.rewrap.busy"));
        return null;
      }
      const generation = (rewrapGenRef.current += 1);
      const run: RewrapRun = { vaultId: id, kind, startedAt: Date.now() };
      rewrapRunRef.current = run;
      setRewrapRun(run);
      setRewrapFailure(null);
      return generation;
    },
    [showToast, t],
  );

  const rewrapStillCurrent = useCallback(
    (generation: number) => generation === rewrapGenRef.current,
    [],
  );

  const clearRewrapRun = useCallback(() => {
    rewrapRunRef.current = null;
    setRewrapRun(null);
  }, []);

  const recordRewrapFailure = useCallback(
    (id: string, kind: RewrapKind, error: unknown) => {
      const key = errorDisplayI18nKey(error);
      const failure: RewrapFailure = {
        vaultId: id,
        kind,
        message: t(mobileErrorI18nKey(error)),
        onPasswordField: rewrapErrorOnPasswordField(key),
      };
      setRewrapFailure(failure);
      const showing = openRef.current && vaultIdRef.current === id && areaRef.current === kind;
      if (!showing) showToast(failure.message);
    },
    [showToast, t],
  );

  const submitPasswordChange = useCallback(async () => {
    if (!vault || !passwordCanSubmit) return;
    if (passwordFields.newPassword !== passwordFields.confirmPassword) {
      setPasswordError(t(createVaultErrorI18nKey("password_mismatch")));
      return;
    }
    const generation = beginRewrap(vault.id, "password");
    if (generation === null) return;
    setPasswordError(null);
    try {
      await vaultSecurityService.changePassword(vault.id, {
        currentPassword: passwordFields.currentPassword,
        newPassword: passwordFields.newPassword,
      });
      if (!rewrapStillCurrent(generation)) return;
      clearRewrapRun();
      const showing =
        openRef.current && vaultIdRef.current === vault.id && areaRef.current === "password";
      if (!openRef.current || vaultIdRef.current === vault.id) resetPasswordForm();
      showToast(t("vault.change_password.success"));
      if (showing) {
        setSavedVisible(true);
        clearTimeout(savedHideRef.current);
        savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
        setSaveConfirmOpen(false);
      }
      try {
        const fresh = await vaultService.getSettings(vault.id);
        if (!fresh) return;
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
      } catch {
        // The password already changed. A settings refresh must not hide that.
      }
    } catch (caught) {
      if (!rewrapStillCurrent(generation)) return;
      clearRewrapRun();
      recordRewrapFailure(vault.id, "password", caught);
    }
  }, [
    beginRewrap,
    clearRewrapRun,
    passwordCanSubmit,
    passwordFields,
    recordRewrapFailure,
    resetPasswordForm,
    rewrapStillCurrent,
    showToast,
    t,
    vault,
    vaultSecurityService,
    vaultService,
  ]);

  const submitKdfChange = useCallback(async () => {
    if (!vault || !kdfFields || !kdfCanSubmit) return;
    const generation = beginRewrap(vault.id, "kdf");
    if (generation === null) return;
    setKdfError(null);
    const nextPreset = kdfFields.nextPreset;
    try {
      await vaultSecurityService.changeKdfPreset(vault.id, {
        currentPassword: kdfFields.password,
        nextPreset,
      });
      if (!rewrapStillCurrent(generation)) return;
      clearRewrapRun();
      const showing =
        openRef.current && vaultIdRef.current === vault.id && areaRef.current === "kdf";
      if (!openRef.current || vaultIdRef.current === vault.id) resetKdfForm();
      showToast(t("vault.change_kdf.success"));
      setHeaderUnlockPreset(nextPreset);
      try {
        if (baseline) {
          onSaved(vault.id, {
            ...vaultSettingsToListPatch(baseline),
            unlockPreset: nextPreset,
          });
        }
      } catch {
        // Unlock RAM already changed. A list refresh must not hide that.
      }
      if (showing) {
        setSavedVisible(true);
        clearTimeout(savedHideRef.current);
        savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
        setSaveConfirmOpen(false);
      }
    } catch (caught) {
      if (!rewrapStillCurrent(generation)) return;
      clearRewrapRun();
      recordRewrapFailure(vault.id, "kdf", caught);
    }
  }, [
    baseline,
    beginRewrap,
    clearRewrapRun,
    kdfCanSubmit,
    kdfFields,
    onSaved,
    recordRewrapFailure,
    resetKdfForm,
    rewrapStillCurrent,
    showToast,
    t,
    vault,
    vaultSecurityService,
  ]);

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

  const handleCloseModal = useCallback(() => {
    busyGenRef.current += 1;
    submitInFlightRef.current = false;
    setBusy(false);
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
    if (busy) return;
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
      void submitPasswordChange();
      return;
    }
    if (activeArea === "kdf") {
      void submitKdfChange();
    }
  };

  if (!open || !vault || !activeArea) return null;

  const modalTitle = t(vaultSettingsAreaTitleKey(activeArea));

  const rewrapHere =
    (activeArea === "password" && passwordRewrapRunning) ||
    (activeArea === "kdf" && kdfRewrapRunning);
  const failureForArea =
    rewrapFailure && vault && rewrapFailure.vaultId === vault.id && rewrapFailure.kind === activeArea
      ? rewrapFailure
      : null;
  const passwordFieldError = failureForArea?.onPasswordField ? failureForArea.message : null;
  const rewrapFormError =
    failureForArea && !failureForArea.onPasswordField ? failureForArea.message : null;

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
        ) : saveError ? (
          <Text style={[typography.caption, { color: colors.onErrorContainer }]}>{saveError}</Text>
        ) : savedVisible ? (
          <Text style={[typography.body, { color: colors.vaultStatusOpen }]}>
            {t("modal.settings.saved")}
          </Text>
        ) : null}
        {rewrapHere && rewrapBudget.visible ? (
          <LoadingBudgetHint
            budgetMs={rewrapBudget.budgetMs}
            remainingMs={rewrapBudget.remainingMs}
          />
        ) : submitBudget.visible ? (
          <LoadingBudgetHint
            budgetMs={submitBudget.budgetMs}
            remainingMs={submitBudget.remainingMs}
          />
        ) : null}
      </View>
      {discardConfirmOpen ? (
        <ModalFooterActions layout="confirm">
          <Button
            variant="danger"
            size="md"
            label={t("modal.settings.discard_confirm_action")}
            style={modalFooterConfirmBtnStyle}
            disabled={busy}
            onPress={handleDiscardConfirmed}
          />
          <Button
            variant="ghost"
            size="md"
            label={t("modal.settings.discard_keep_editing")}
            style={modalFooterConfirmBtnStyle}
            disabled={busy}
            onPress={dismissFooterConfirm}
          />
        </ModalFooterActions>
      ) : (
        <ModalFooterActions layout="confirm">
          <Button
            size="md"
            variant="primary"
            label={saveLabel}
            style={modalFooterConfirmBtnStyle}
            onPress={() => {
              if (saveConfirmOpen) void handleConfirmSave();
              else handleSaveClick();
            }}
            disabled={saveDisabled}
            busy={busy || rewrapHere}
          />
          {saveConfirmOpen ? (
            <Button
              size="md"
              variant="ghost"
              label={t("modal.settings.save_cancel")}
              style={modalFooterConfirmBtnStyle}
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
        ) : loading && loadBudget.visible ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
            <LoadingBudgetHint
              budgetMs={loadBudget.budgetMs}
              remainingMs={loadBudget.remainingMs}
            />
          </View>
        ) : draft ? (
          activeArea === "preferences" ? (
            <VaultSettingsForm
              draft={draft}
              patchDraft={patchDraft}
              storageModeLocked={storageModeLocked}
              displayNameLocked={displayNameLocked}
              mountLocked={mountLocked}
              securityModeLocked={securityModeLocked}
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
                      {canDeleteNow ? null : (
                        <Text style={typography.bodyMuted}>
                          {t("modal.settings.delete_only_closed")}
                        </Text>
                      )}
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
});
