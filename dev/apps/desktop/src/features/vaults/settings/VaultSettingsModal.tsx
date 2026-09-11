import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, LoadingBudgetHint, Modal } from "@/components/ui";
import { useTranslation, type I18nKey } from "@/i18n";
import { useErrorToast } from "@/hooks/useErrorToast";
import { useLoadingBudget } from "@upriv/shared/react";
import { useVaultRootService, useVaultSecurityService, useVaultService } from "@/platform/services";
import {
  VaultChangeKdfFields,
  VaultChangePasswordFields,
  VaultSettingsBackupSection,
  VaultSettingsCloseSection,
  VaultSettingsDangerZoneSection,
  VaultSettingsMountSection,
  VaultSettingsPolicySection,
  VaultSettingsSecuritySection,
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
  VaultGroup,
  VaultListItem,
  VaultSettingsAreaId,
  VaultSettingsConfig,
  VaultSettingsListPatch,
  VaultSettingsSectionId,
  KdfUnlockPreset,
} from "@upriv/shared";
import {
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  changeKdfFormCanSubmit,
  DEFAULT_KDF_UNLOCK_PRESET,
  LOADING_BUDGET_MS,
  changeKdfFormIsDirty,
  changePasswordFormCanSubmit,
  changePasswordFormIsDirty,
  displayNameErrorI18nKey,
  EMPTY_CHANGE_PASSWORD_FIELDS,
  errorDisplayI18nKey,
  NO_VAULT_GROUPS,
  isVaultInHiddenGroup,
  isHiddenGroup,
  selectedGroupIdAfterAssignment,
  normalizeVaultSettingsConfig,
  vaultSettingsEqual,
  patchStorageMode,
  validateDisplayName,
  vaultSettingsAreaTitleKey,
  VAULT_SETTINGS_AREA_ICON,
  vaultSettingsPreferenceSections,
  vaultSettingsToListPatch,
  vaultRootPathForWorkspaceValidation,
} from "@upriv/shared";
import { createVaultErrorI18nKey, desktopErrorI18nKey } from "@/lib/errorMessages";

const SAVED_INDICATOR_MS = 1500;

interface VaultSettingsModalProps {
  vault: VaultListItem | null;
  /** Which settings screen the gear menu opened. */
  area: VaultSettingsAreaId | null;
  open: boolean;
  onClose: () => void;
  groups?: readonly VaultGroup[];
  onVaultSettingsSaved?: (vaultId: string, patch: VaultSettingsListPatch) => void;
  onCommitGroupAssignment?: (
    vaultId: string,
    assignment: CreateVaultGroupAssignment,
  ) => Promise<void> | void;
  onVaultDelete?: (vaultId: string) => Promise<void> | void;
}

export function VaultSettingsModal({
  vault,
  area,
  open,
  onClose,
  groups = NO_VAULT_GROUPS,
  onVaultSettingsSaved,
  onCommitGroupAssignment,
  onVaultDelete,
}: VaultSettingsModalProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const { settings: appSettings, showHiddenVaultsSession } = useAppSettingsContext();
  const vaultService = useVaultService();
  const vaultRootService = useVaultRootService();
  const vaultSecurityService = useVaultSecurityService();
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
  const [groupNameError, setGroupNameError] = useState<string | null>(null);
  const [passwordFields, setPasswordFields] = useState<ChangePasswordFieldsState>(
    EMPTY_CHANGE_PASSWORD_FIELDS,
  );
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [kdfFields, setKdfFields] = useState<ChangeKdfFieldsState | null>(null);
  const [kdfError, setKdfError] = useState<string | null>(null);
  const [kdfSubmitting, setKdfSubmitting] = useState(false);
  const [headerUnlockPreset, setHeaderUnlockPreset] = useState<KdfUnlockPreset | undefined>();
  const [sectionBusy, setSectionBusy] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [mountPathIssue, setMountPathIssue] = useState(false);
  const [resolvedRootPath, setResolvedRootPath] = useState<string | null>(null);
  /** Invalidates a submit whose loading budget already expired. */
  const sectionBusyGenRef = useRef(0);

  const confirmInputId = useId();
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedForVaultRef = useRef<string | null>(null);
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
    let cancelled = false;
    void vaultService.getUnlockPreset(vaultId).then((preset) => {
      if (!cancelled) setHeaderUnlockPreset(preset ?? DEFAULT_KDF_UNLOCK_PRESET);
    });
    return () => {
      cancelled = true;
    };
  }, [open, vaultId, vaultService]);

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

  const canConfirmDelete = vault !== null && deleteConfirm.trim() === vault.id;
  const vaultOpen = vault?.session === "open";

  const baseline = useMemo(() => (config ? normalizeVaultSettingsConfig(config) : null), [config]);

  const baselineGroupId = useMemo(
    () =>
      vaultId ? (groups.find((group) => group.groupedVaults.includes(vaultId))?.id ?? "") : "",
    [groups, vaultId],
  );

  const pendingGroupName = newGroupName.trim();
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

  const passwordCanSubmit = changePasswordFormCanSubmit({
    ...passwordFields,
    submitting: passwordSubmitting,
  });

  const kdfCanSubmit =
    headerUnlockPreset !== undefined &&
    changeKdfFormCanSubmit({
      password: kdfFields?.password ?? "",
      nextPreset: kdfFields?.nextPreset ?? headerUnlockPreset,
      currentPreset: headerUnlockPreset,
      vaultOpen,
      submitting: kdfSubmitting,
    });

  const resetPasswordForm = useCallback(() => {
    setPasswordFields(EMPTY_CHANGE_PASSWORD_FIELDS);
    setPasswordError(null);
    setPasswordSubmitting(false);
  }, []);

  const resetKdfForm = useCallback(() => {
    setKdfFields(null);
    setKdfError(null);
    setKdfSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open || !vaultId) return;
    if (openedForVaultRef.current === vaultId) return;
    openedForVaultRef.current = vaultId;
    setDraft(null);
    setSelectedGroupId(
      groupsRef.current.find((group) => group.groupedVaults.includes(vaultId))?.id ?? "",
    );
    setNewGroupName("");
    setGroupNameError(null);
  }, [open, vaultId]);

  useEffect(() => {
    if (!open || !config || !vaultId) return;
    if (openedForVaultRef.current !== vaultId) return;
    setDraft((current) => current ?? normalizeVaultSettingsConfig(config));
  }, [open, vaultId, config]);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      openedForVaultRef.current = null;
      setSaveConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
      setDeleteOpen(false);
      setDeleteConfirm("");
      setSelectedGroupId("");
      setNewGroupName("");
      setGroupNameError(null);
      resetPasswordForm();
      resetKdfForm();
      setLoadTimedOut(false);
    }
  }, [open, vaultId, resetPasswordForm, resetKdfForm]);

  useEffect(() => {
    if (!areaDirty) setSaveConfirmOpen(false);
  }, [areaDirty]);

  useEffect(() => {
    return () => clearTimeout(savedHideRef.current);
  }, []);

  useEffect(() => {
    if (activeArea !== "kdf") return;
    setKdfFields((current) =>
      current
        ? { ...current, nextPreset: headerUnlockPreset ?? DEFAULT_KDF_UNLOCK_PRESET }
        : {
            password: "",
            nextPreset: headerUnlockPreset ?? DEFAULT_KDF_UNLOCK_PRESET,
          },
    );
  }, [activeArea, headerUnlockPreset]);

  const flashSaved = useCallback(() => {
    setSavedVisible(true);
    clearTimeout(savedHideRef.current);
    savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
  }, []);

  const persistPreferences = useCallback(
    async (next: VaultSettingsConfig) => {
      if (!vaultId || !baseline) return;
      const normalized = normalizeVaultSettingsConfig(next);
      const locked = Boolean(vaultId && isVaultInHiddenGroup(groupsRef.current, vaultId));
      const toSave =
        locked && !normalized.vault.hidden
          ? { ...normalized, vault: { ...normalized.vault, hidden: true } }
          : normalized;
      const generation = (sectionBusyGenRef.current += 1);
      setSectionBusy(true);
      try {
        await vaultService.registerSettings(vaultId, toSave);
        if (generation !== sectionBusyGenRef.current) return;
        replaceConfig(toSave);
        setDraft(toSave);
        onVaultSettingsSaved?.(vaultId, vaultSettingsToListPatch(toSave));
        flashSaved();
        setSaveConfirmOpen(false);
      } catch (error) {
        if (generation !== sectionBusyGenRef.current) return;
        showError(error, "error.settings_save_failed");
      } finally {
        if (generation === sectionBusyGenRef.current) setSectionBusy(false);
      }
    },
    [vaultId, baseline, replaceConfig, onVaultSettingsSaved, showError, vaultService, flashSaved],
  );

  const persistGroupAssignment = useCallback(async () => {
    if (!vaultId || !groupDirty) return;
    const generation = (sectionBusyGenRef.current += 1);
    setSectionBusy(true);
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
      await onCommitGroupAssignment?.(vaultId, assignment);
      if (generation !== sectionBusyGenRef.current) return;
      setNewGroupName("");
      setGroupNameError(null);
      setSelectedGroupId(nextSelectedId);
      if (nextSelectedId && isHiddenGroup(groupsRef.current, nextSelectedId)) {
        lockDraftHidden();
      }
      flashSaved();
      setSaveConfirmOpen(false);
    } catch (error) {
      if (generation !== sectionBusyGenRef.current) return;
      showError(error, "error.settings_save_failed");
    } finally {
      if (generation === sectionBusyGenRef.current) setSectionBusy(false);
    }
  }, [
    vaultId,
    groupDirty,
    pendingGroupName,
    selectedGroupId,
    onCommitGroupAssignment,
    showError,
    flashSaved,
    lockDraftHidden,
  ]);

  const submitPasswordChange = useCallback(async () => {
    if (!vaultId || !passwordCanSubmit) return;
    if (passwordFields.newPassword !== passwordFields.confirmPassword) {
      setPasswordError(t(createVaultErrorI18nKey("password_mismatch")));
      return;
    }
    setPasswordError(null);
    const generation = (sectionBusyGenRef.current += 1);
    setPasswordSubmitting(true);
    setSectionBusy(true);
    try {
      await vaultSecurityService.changePassword(vaultId, {
        currentPassword: passwordFields.currentPassword,
        newPassword: passwordFields.newPassword,
      });
      if (generation !== sectionBusyGenRef.current) return;
      resetPasswordForm();
      flashSaved();
      setSaveConfirmOpen(false);
    } catch (error) {
      if (generation !== sectionBusyGenRef.current) return;
      setPasswordError(t(errorDisplayI18nKey(error) ?? "error.settings_save_failed"));
    } finally {
      if (generation === sectionBusyGenRef.current) {
        setPasswordSubmitting(false);
        setSectionBusy(false);
      }
    }
  }, [
    vaultId,
    passwordCanSubmit,
    passwordFields,
    vaultSecurityService,
    t,
    flashSaved,
    resetPasswordForm,
  ]);

  const submitKdfChange = useCallback(async () => {
    if (!vaultId || !kdfFields || !kdfCanSubmit) return;
    setKdfError(null);
    const generation = (sectionBusyGenRef.current += 1);
    setKdfSubmitting(true);
    setSectionBusy(true);
    try {
      await vaultSecurityService.changeKdfPreset(vaultId, {
        currentPassword: kdfFields.password,
        nextPreset: kdfFields.nextPreset,
      });
      if (generation !== sectionBusyGenRef.current) return;
      await vaultService.setUnlockPreset(vaultId, kdfFields.nextPreset);
      if (generation !== sectionBusyGenRef.current) return;
      setHeaderUnlockPreset(kdfFields.nextPreset);
      resetKdfForm();
      flashSaved();
      setSaveConfirmOpen(false);
    } catch (error) {
      if (generation !== sectionBusyGenRef.current) return;
      setKdfError(t(errorDisplayI18nKey(error) ?? "error.settings_save_failed"));
    } finally {
      if (generation === sectionBusyGenRef.current) {
        setKdfSubmitting(false);
        setSectionBusy(false);
      }
    }
  }, [
    vaultId,
    kdfFields,
    kdfCanSubmit,
    vaultSecurityService,
    vaultService,
    t,
    flashSaved,
    resetKdfForm,
  ]);

  const submitBudget = useLoadingBudget(sectionBusy, LOADING_BUDGET_MS.vaultRewrap);
  const settingsLoading = Boolean(open && vaultId && loading && !loadTimedOut);
  const loadBudget = useLoadingBudget(settingsLoading, LOADING_BUDGET_MS.settingsLoad);

  useEffect(() => {
    if (!loadBudget.timedOut || !settingsLoading) return;
    invalidateLoad();
    setLoadTimedOut(true);
  }, [loadBudget.timedOut, settingsLoading, invalidateLoad]);

  useEffect(() => {
    if (!submitBudget.timedOut) return;
    sectionBusyGenRef.current += 1;
    setSectionBusy(false);
    setPasswordSubmitting(false);
    setKdfSubmitting(false);
    showError(new Error("settings submit timed out"), "error.operation_timed_out");
  }, [submitBudget.timedOut, showError]);

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
  }, []);

  const patchDraft = useCallback(
    <S extends keyof VaultSettingsConfig>(section: S, patch: Partial<VaultSettingsConfig[S]>) => {
      setDiscardConfirmOpen(false);
      setSaveConfirmOpen(false);
      setDraft((current) => {
        if (!current) return current;

        if (section === "storage" && "mode" in patch && typeof patch.mode === "string") {
          if (vaultOpen) return current;
          return patchStorageMode(current, patch.mode as StorageMode);
        }

        return {
          ...current,
          [section]: { ...current[section], ...patch },
        };
      });
    },
    [vaultOpen],
  );

  const resetActiveAreaDraft = useCallback(() => {
    if (activeArea === "preferences") {
      if (baseline) setDraft(baseline);
    } else if (activeArea === "group") {
      setSelectedGroupId(baselineGroupId);
      setNewGroupName("");
      setGroupNameError(null);
    } else if (activeArea === "password") {
      resetPasswordForm();
    } else if (activeArea === "kdf") {
      resetKdfForm();
    }
  }, [activeArea, baseline, baselineGroupId, resetPasswordForm, resetKdfForm]);

  const handleCloseModal = () => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setDeleteOpen(false);
    setDeleteConfirm("");
    onClose();
  };

  const requestCloseModal = () => {
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
    resetActiveAreaDraft();
    setDiscardConfirmOpen(false);
    handleCloseModal();
  };

  const handleSaveClick = () => {
    if (!activeArea || !areaDirty || sectionBusy) return;

    if (activeArea === "group" && pendingGroupName) {
      const validation = validateDisplayName(pendingGroupName);
      if (validation) {
        setGroupNameError(
          t(
            displayNameErrorI18nKey(validation),
            validation === "too_long" ? { max: String(VAULT_DISPLAY_NAME_MAX_LENGTH) } : undefined,
          ),
        );
        return;
      }
    }
    setGroupNameError(null);
    dismissFooterConfirm();
    setSaveConfirmOpen(true);
  };

  const handleConfirmSave = () => {
    if (!activeArea || sectionBusy) return;
    if (activeArea === "preferences") {
      if (!draft || !preferencesDirty) return;
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
    if (!canConfirmDelete || !vault || sectionBusy) return;
    const generation = (sectionBusyGenRef.current += 1);
    setSectionBusy(true);
    try {
      await onVaultDelete?.(vault.id);
      if (generation !== sectionBusyGenRef.current) return;
      setDeleteOpen(false);
      setDeleteConfirm("");
      handleCloseModal();
    } catch (error) {
      if (generation !== sectionBusyGenRef.current) return;
      showError(error, "error.settings_save_failed");
    } finally {
      if (generation === sectionBusyGenRef.current) setSectionBusy(false);
    }
  };

  const formConfig = draft ?? config;
  if (!open || !vault || !activeArea) return null;

  const modalTitle = t(vaultSettingsAreaTitleKey(activeArea));

  const saveLabel =
    activeArea === "password"
      ? passwordSubmitting
        ? t("vault.change_password.submitting")
        : t("vault.change_password.submit")
      : activeArea === "kdf"
        ? kdfSubmitting
          ? t("vault.change_kdf.submitting")
          : t("vault.change_kdf.submit")
        : saveConfirmOpen
          ? t("modal.settings.save_confirm_action")
          : t("modal.settings.save");

  const saveDisabled =
    sectionBusy ||
    !areaDirty ||
    mountPathIssue ||
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
          ) : null}
          {submitBudget.visible ? (
            <LoadingBudgetHint
              budgetMs={submitBudget.budgetMs}
              remainingMs={submitBudget.remainingMs}
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row-reverse sm:flex-wrap sm:justify-end [&_button]:w-full sm:[&_button]:w-auto">
            {discardConfirmOpen ? (
              <>
                <Button variant="danger" size="md" onClick={handleDiscardConfirmed}>
                  {t("modal.settings.discard_confirm_action")}
                </Button>
                <Button variant="ghost" size="md" onClick={dismissFooterConfirm}>
                  {t("modal.settings.discard_keep_editing")}
                </Button>
              </>
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
                  <Button variant="ghost" size="md" onClick={dismissFooterConfirm}>
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
                setGroupNameError(null);
                dismissFooterConfirm();
                if (isHiddenGroup(groups, groupId)) lockDraftHidden();
              }}
              onNewGroupNameChange={(name) => {
                setNewGroupName(name);
                setGroupNameError(null);
                dismissFooterConfirm();
              }}
            />
            {groupNameError ? (
              <p className="text-sm text-on-error-container">{groupNameError}</p>
            ) : null}
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
        ) : loadError ? (
          <div className="py-10 text-center text-sm text-on-surface-variant">
            <p role="alert">{t(desktopErrorI18nKey(loadError))}</p>
            <div className="mt-4 flex justify-center">
              <Button variant="primary" size="md" onClick={retryLoad}>
                {t("action.retry")}
              </Button>
            </div>
          </div>
        ) : settingsLoading && loadBudget.visible ? (
          <div className="py-10 text-center font-mono text-sm text-on-surface-variant">
            <LoadingBudgetHint
              budgetMs={loadBudget.budgetMs}
              remainingMs={loadBudget.remainingMs}
            />
          </div>
        ) : formConfig ? (
          <>
            {activeArea === "preferences" ? (
              <>
                {vaultSettingsPreferenceSections(formConfig.storage.mode).map((sectionId) => (
                  <VaultSettingsSection
                    key={sectionId}
                    title={t(`modal.settings.section.${sectionId}` as I18nKey)}
                    defaultOpen={sectionId === "vault"}
                  >
                    {renderPreferenceSection(
                      sectionId,
                      formConfig,
                      patchDraft,
                      vaultOpen,
                      vaultRootPathForWorkspaceValidation(
                        appSettings.app.vault_root_mode,
                        appSettings.app.upriv_root_path,
                        resolvedRootPath,
                      ),
                      setMountPathIssue,
                      hiddenLocked,
                    )}
                  </VaultSettingsSection>
                ))}

                <VaultSettingsSection
                  key={deleteOpen ? "danger-zone-open" : "danger-zone"}
                  title={t("modal.settings.danger_zone")}
                  tone="danger"
                  defaultOpen={deleteOpen}
                >
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
                    onCancelDelete={() => {
                      setDeleteOpen(false);
                      setDeleteConfirm("");
                    }}
                    onConfirmDelete={() => {
                      void handleConfirmDelete();
                    }}
                    onConfirmChange={setDeleteConfirm}
                    busy={sectionBusy}
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
                  onChange={(patch) => {
                    setPasswordFields((current) => ({ ...current, ...patch }));
                    setPasswordError(null);
                    dismissFooterConfirm();
                  }}
                  error={passwordError}
                />
              </div>
            ) : activeArea === "kdf" && kdfFields && headerUnlockPreset !== undefined ? (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  {t("modal.settings.section.kdf_settings_intro")}
                </p>
                <VaultChangeKdfFields
                  currentPreset={headerUnlockPreset}
                  vaultOpen={vaultOpen}
                  fields={kdfFields}
                  onChange={(patch) => {
                    setKdfFields((current) => (current ? { ...current, ...patch } : current));
                    setKdfError(null);
                    dismissFooterConfirm();
                  }}
                  error={kdfError}
                />
              </div>
            ) : activeArea === "kdf" ? (
              <p className="text-sm leading-relaxed text-on-surface-variant">
                {t("vault.list.loading")}
              </p>
            ) : null}
          </>
        ) : (
          <div className="py-10" aria-busy="true" />
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
  storageModeLocked: boolean,
  vaultRootPath: string | null,
  onMountPathIssue: (invalid: boolean) => void,
  hiddenLocked: boolean,
) {
  switch (sectionId) {
    case "vault":
      return (
        <VaultSettingsVaultSection
          config={draft.vault}
          hiddenLocked={hiddenLocked}
          onChange={(patch) => patchDraft("vault", patch)}
        />
      );
    case "storage":
      return (
        <VaultSettingsStorageSection
          config={draft.storage}
          storageModeLocked={storageModeLocked}
          onChange={(patch) => patchDraft("storage", patch)}
        />
      );
    case "mount":
      return (
        <VaultSettingsMountSection
          config={draft.mount}
          vaultRootPath={vaultRootPath}
          onPathIssueChange={(issue) => onMountPathIssue(issue != null)}
          onChange={(patch) => patchDraft("mount", patch)}
        />
      );
    case "auto_close":
      return (
        <VaultSettingsCloseSection
          autoClose={draft.auto_close}
          secureWipe={draft.security.secure_wipe_workspace}
          requireUnmountOnSleep={draft.policy.require_unmount_on_sleep}
          onAutoCloseChange={(patch) => patchDraft("auto_close", patch)}
          onSecureWipeChange={(secure_wipe_workspace) =>
            patchDraft("security", { secure_wipe_workspace })
          }
          onRequireUnmountOnSleepChange={(require_unmount_on_sleep) =>
            patchDraft("policy", { require_unmount_on_sleep })
          }
        />
      );
    case "backup":
      return (
        <VaultSettingsBackupSection
          config={draft.backup}
          onChange={(patch) => patchDraft("backup", patch)}
        />
      );
    case "security":
      return (
        <VaultSettingsSecuritySection
          storageMode={draft.storage.mode}
          config={draft.security}
          passwordHint={draft.vault.password_hint}
          onChange={(patch) => patchDraft("security", patch)}
          onPasswordHintChange={(password_hint) => patchDraft("vault", { password_hint })}
        />
      );
    case "policy":
      return (
        <VaultSettingsPolicySection
          config={draft.policy}
          onChange={(patch) => patchDraft("policy", patch)}
        />
      );
    default:
      return null;
  }
}
