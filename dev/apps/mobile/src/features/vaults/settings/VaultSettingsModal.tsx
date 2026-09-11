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
  displayNameErrorI18nKey,
  EMPTY_CHANGE_PASSWORD_FIELDS,
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
  vaultSettingsToListPatch,
  vaultRootPathForWorkspaceValidation,
  type CreateVaultGroupAssignment,
  type ChangeKdfFieldsState,
  type ChangePasswordFieldsState,
  type StorageMode,
  type VaultGroup,
  type VaultListItem,
  type VaultSettingsAreaId,
  type VaultSettingsConfig,
  type KdfUnlockPreset,
} from "@upriv/shared";
import { useVaultRootService, useVaultSecurityService, useVaultService } from "@/platform/services";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import {
  Button,
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

const SAVED_INDICATOR_MS = 1500;

interface VaultSettingsModalProps {
  vault: VaultListItem | null;
  /** Which settings screen the gear menu opened. */
  area: VaultSettingsAreaId | null;
  open: boolean;
  onClose: () => void;
  onSaved: (vaultId: string, patch: ReturnType<typeof vaultSettingsToListPatch>) => void;
  showToast: (message: string) => void;
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
  onSaved,
  showToast,
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
  const vaultOpen = vault?.session === "open";
  const activeArea = open ? area : null;

  const [draft, setDraft] = useState<VaultSettingsConfig | null>(null);
  const [baseline, setBaseline] = useState<VaultSettingsConfig | null>(null);
  const [busy, setBusy] = useState(false);
  /** Invalidates a submit whose loading budget already expired. */
  const busyGenRef = useRef(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [groupNameError, setGroupNameError] = useState<string | null>(null);
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
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [kdfFields, setKdfFields] = useState<ChangeKdfFieldsState | null>(null);
  const [kdfError, setKdfError] = useState<string | null>(null);
  const [kdfSubmitting, setKdfSubmitting] = useState(false);
  const [headerUnlockPreset, setHeaderUnlockPreset] = useState<KdfUnlockPreset | undefined>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [mountPathIssue, setMountPathIssue] = useState(false);
  const [resolvedRootPath, setResolvedRootPath] = useState<string | null>(null);

  const loadGen = useRef(0);
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

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

  const loading = Boolean(open && vaultId && !draft && !loadError && !loadTimedOut);
  const loadBudget = useLoadingBudget(loading, LOADING_BUDGET_MS.settingsLoad);

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

  const reload = useCallback(() => {
    setLoadAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!open || !vaultId) {
      loadGen.current += 1;
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
      setGroupNameError(null);
      resetPasswordForm();
      resetKdfForm();
      setDeleteOpen(false);
      setDeleteConfirm("");
      return;
    }

    let cancelled = false;
    const gen = ++loadGen.current;
    setDraft(null);
    setBaseline(null);
    setLoadError(null);
    setSaveError(null);
    setLoadTimedOut(false);
    setSelectedGroupId(
      groupsRef.current.find((group) => group.groupedVaults.includes(vaultId))?.id ?? "",
    );
    setNewGroupName("");
    setGroupNameError(null);

    const apply = (settings: VaultSettingsConfig) => {
      const normalized = cloneSettings(normalizeVaultSettingsConfig(settings));
      setBaseline(normalized);
      setDraft(cloneSettings(normalized));
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
    setKdfFields((current) =>
      current
        ? { ...current, nextPreset: headerUnlockPreset ?? DEFAULT_KDF_UNLOCK_PRESET }
        : {
            password: "",
            nextPreset: headerUnlockPreset ?? DEFAULT_KDF_UNLOCK_PRESET,
          },
    );
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

  const submitBudget = useLoadingBudget(busy, LOADING_BUDGET_MS.vaultRewrap);

  useEffect(() => {
    if (!submitBudget.timedOut) return;
    busyGenRef.current += 1;
    setBusy(false);
    setPasswordSubmitting(false);
    setKdfSubmitting(false);
    setSaveError(t("error.operation_timed_out"));
  }, [submitBudget.timedOut, t]);

  const flashSaved = useCallback(() => {
    showToast(t("modal.settings.saved"));
    setSavedVisible(true);
    clearTimeout(savedHideRef.current);
    savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
  }, [showToast, t]);

  const persistPreferences = useCallback(async () => {
    if (!vault || !draft || busy || !preferencesDirty || !baseline) return;
    const generation = (busyGenRef.current += 1);
    setBusy(true);
    setSaveError(null);
    try {
      const normalized = normalizeVaultSettingsConfig(draft);
      const locked = Boolean(vault && isVaultInHiddenGroup(groupsRef.current, vault.id));
      const toSave =
        locked && !normalized.vault.hidden
          ? { ...normalized, vault: { ...normalized.vault, hidden: true } }
          : normalized;
      await vaultService.registerSettings(vault.id, toSave);
      if (generation !== busyGenRef.current) return;
      setBaseline(toSave);
      setDraft(toSave);
      onSaved(vault.id, vaultSettingsToListPatch(toSave));
      flashSaved();
      setSaveConfirmOpen(false);
    } catch (caught) {
      if (generation !== busyGenRef.current) return;
      setSaveError(t(mobileErrorI18nKey(caught)));
    } finally {
      if (generation === busyGenRef.current) setBusy(false);
    }
  }, [vault, draft, busy, preferencesDirty, baseline, vaultService, onSaved, flashSaved, t]);

  const persistGroupAssignment = useCallback(async () => {
    if (!vault || busy || !groupDirty) return;
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
      setGroupNameError(null);
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
      if (generation === busyGenRef.current) setBusy(false);
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

  const submitPasswordChange = useCallback(async () => {
    if (!vault || !passwordCanSubmit) return;
    if (passwordFields.newPassword !== passwordFields.confirmPassword) {
      setPasswordError(t(createVaultErrorI18nKey("password_mismatch")));
      return;
    }
    setPasswordError(null);
    const generation = (busyGenRef.current += 1);
    setPasswordSubmitting(true);
    setBusy(true);
    try {
      await vaultSecurityService.changePassword(vault.id, {
        currentPassword: passwordFields.currentPassword,
        newPassword: passwordFields.newPassword,
      });
      if (generation !== busyGenRef.current) return;
      resetPasswordForm();
      flashSaved();
      setSaveConfirmOpen(false);
    } catch (caught) {
      if (generation !== busyGenRef.current) return;
      setPasswordError(t(mobileErrorI18nKey(caught)));
    } finally {
      if (generation === busyGenRef.current) {
        setPasswordSubmitting(false);
        setBusy(false);
      }
    }
  }, [
    vault,
    passwordCanSubmit,
    passwordFields,
    vaultSecurityService,
    t,
    flashSaved,
    resetPasswordForm,
  ]);

  const submitKdfChange = useCallback(async () => {
    if (!vault || !kdfFields || !kdfCanSubmit) return;
    setKdfError(null);
    const generation = (busyGenRef.current += 1);
    setKdfSubmitting(true);
    setBusy(true);
    try {
      await vaultSecurityService.changeKdfPreset(vault.id, {
        currentPassword: kdfFields.password,
        nextPreset: kdfFields.nextPreset,
      });
      if (generation !== busyGenRef.current) return;
      await vaultService.setUnlockPreset(vault.id, kdfFields.nextPreset);
      if (generation !== busyGenRef.current) return;
      setHeaderUnlockPreset(kdfFields.nextPreset);
      resetKdfForm();
      flashSaved();
      setSaveConfirmOpen(false);
    } catch (caught) {
      if (generation !== busyGenRef.current) return;
      setKdfError(t(mobileErrorI18nKey(caught)));
    } finally {
      if (generation === busyGenRef.current) {
        setKdfSubmitting(false);
        setBusy(false);
      }
    }
  }, [
    vault,
    kdfFields,
    kdfCanSubmit,
    vaultSecurityService,
    vaultService,
    resetKdfForm,
    flashSaved,
    t,
  ]);

  const resetActiveAreaDraft = useCallback(() => {
    if (activeArea === "preferences") {
      if (baseline) setDraft(cloneSettings(baseline));
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

  const handleCloseModal = useCallback(() => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setDeleteOpen(false);
    setDeleteConfirm("");
    onClose();
  }, [onClose]);

  const canConfirmDelete = vault !== null && deleteConfirm.trim() === vault.id;

  const handleConfirmDelete = useCallback(() => {
    if (!canConfirmDelete || !vault) return;
    onVaultDelete?.(vault.id);
    handleCloseModal();
  }, [canConfirmDelete, vault, onVaultDelete, handleCloseModal]);

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
    if (!activeArea || !areaDirty || busy) return;
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
    busy ||
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
        {submitBudget.visible ? (
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
            onPress={handleDiscardConfirmed}
          />
          <Button
            variant="ghost"
            size="md"
            label={t("modal.settings.discard_keep_editing")}
            style={modalFooterConfirmBtnStyle}
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
            busy={busy}
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
            nameError={groupNameError}
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
        ) : loadError ? (
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
              storageModeLocked={vaultOpen}
              vaultRootPath={vaultRootPathForWorkspaceValidation(
                appSettings.app.vault_root_mode,
                appSettings.app.upriv_root_path,
                resolvedRootPath,
              )}
              onPathIssueChange={(issue) => setMountPathIssue(issue != null)}
              hiddenLocked={hiddenLocked}
            >
              {onVaultDelete ? (
                <SettingsAccordionSection
                  key={deleteOpen ? "danger-zone-open" : "danger-zone"}
                  title={t("modal.settings.danger_zone")}
                  tone="danger"
                  defaultOpen={deleteOpen}
                >
                  {!deleteOpen ? (
                    <View style={styles.section}>
                      <Text style={typography.bodyMuted}>
                        {t("modal.settings.danger_zone_help")}
                      </Text>
                      <Button
                        variant="danger"
                        size="sm"
                        label={t("modal.settings.delete_vault")}
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
                          disabled={!canConfirmDelete}
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
                onChange={(patch) => {
                  setPasswordFields((current) => ({ ...current, ...patch }));
                  setPasswordError(null);
                  dismissFooterConfirm();
                }}
                error={passwordError}
              />
            </View>
          ) : activeArea === "kdf" && kdfFields && headerUnlockPreset !== undefined ? (
            <View style={styles.section}>
              <FieldHint>{t("modal.settings.section.kdf_settings_intro")}</FieldHint>
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
            </View>
          ) : activeArea === "kdf" ? (
            <Text style={typography.bodyMuted}>{t("vault.list.loading")}</Text>
          ) : null
        ) : (
          <View style={styles.placeholder} accessibilityState={{ busy: true }} />
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
  placeholder: { minHeight: 160 },
  footerCol: { gap: spacing.sm },
});
