import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { VaultSettingsSection } from "@/components/settings";
import { useErrorToast } from "@/hooks/useErrorToast";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { useOperationLimit, useVaultRootIntegrityClose } from "@upriv/shared/react";
import { useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import {
  APP_SETTINGS_ERROR_I18N_KEYS,
  APP_SETTINGS_SECTIONS,
  appSettingsEqual,
  backupFolderLeftBehind,
  backupFolderSystem,
  vaultBackupFolders,
  isRpcError,
  shouldBumpVaultRootEpoch,
  normalizeAppSettings,
  validateWorkspaceTable,
  currentWorkspaceSystem,
  workspaceTablesEqual,
  vaultRootGoneRpcError,
  vaultRootPathForWorkspaceValidation,
  type AppSettingsConfig,
  type AppSettingsSectionId,
} from "@upriv/shared";
import {
  AppSettingsBackupsSection,
  AppSettingsGeneralSection,
  AppSettingsGroupsPrefsSection,
  AppSettingsHiddenVaultsSection,
  AppSettingsLanguageSection,
  AppSettingsLoggingSection,
  AppSettingsVaultListSection,
  AppSettingsWorkspaceSection,
} from "./appSettingsForm";

const SAVED_INDICATOR_MS = 1500;

interface AppSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Report unsaved draft so the list shell can refuse opening Data folder. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Disable Clear on workspace path while any vault session is open. */
  hasOpenVault?: boolean;
  /** List toast. A save keeps running after the window closes and reports here. */
  onNotice?: (message: string) => void;
}

/** A save in flight, or one that failed, shown again when the window reopens. */
type PendingAppSave = {
  config: AppSettingsConfig;
  showHidden: boolean;
  /** `null` while it runs; the error line once it failed. */
  failure: string | null;
};

/**
 * System settings for the **active** vault-root (language, general UI, vault list, groups, logging, hidden vaults).
 * Creating groups lives in `VaultGroupsModal` (⋯ menu). Data folder is `VaultRootDataFolderModal`.
 */
export function AppSettingsModal({
  open,
  onClose,
  onDirtyChange,
  hasOpenVault = false,
  onNotice,
}: AppSettingsModalProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const openRef = useRef(open);
  openRef.current = open;
  const vaultRootService = useVaultRootService();
  const {
    settings,
    replaceSettings,
    showHiddenVaultsSession,
    setShowHiddenVaultsSession,
    settingsOnDisk,
    reportVaultRootIntegrityFailure,
  } = useAppSettingsContext();

  const [draft, setDraft] = useState<AppSettingsConfig | null>(null);
  const [draftShowHiddenVaultsSession, setDraftShowHiddenVaultsSession] = useState(false);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [backupFolderBlocking, setBackupFolderBlocking] = useState(false);
  const [resolvedRootPath, setResolvedRootPath] = useState<string | null>(null);
  const [resolveFailure, setResolveFailure] = useState<unknown>(null);
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedSessionRef = useRef(false);
  /** True after the user patches workspace this modal session — skip live Context sync. */
  const workspaceTouchedRef = useRef(false);
  const commitSaveLock = useRef(false);
  /** Bumped only when a save runs past `OPERATION_LIMIT_MS`; closing never drops a result. */
  const saveBusyGen = useRef(0);
  const saveLimit = useOperationLimit(saveBusy);
  const [pendingSave, setPendingSave] = useState<PendingAppSave | null>(null);
  const pendingSaveRef = useRef(pendingSave);
  pendingSaveRef.current = pendingSave;

  const isDirty = useMemo(
    () =>
      Boolean(draft && !appSettingsEqual(draft, settings)) ||
      draftShowHiddenVaultsSession !== showHiddenVaultsSession,
    [draft, draftShowHiddenVaultsSession, settings, showHiddenVaultsSession],
  );

  useEffect(() => {
    onDirtyChange?.(open && isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange, open]);

  useEffect(() => {
    if (!open) return;
    if (openedSessionRef.current) return;
    openedSessionRef.current = true;
    // A save still running, or one that failed, shows its values again.
    const pending = pendingSaveRef.current;
    workspaceTouchedRef.current = pending !== null;
    setDraft(pending?.config ?? settings);
    setDraftShowHiddenVaultsSession(pending?.showHidden ?? showHiddenVaultsSession);
  }, [open, settings, showHiddenVaultsSession]);

  // Keep draft.app aligned with live Context so Save never sends a stale vault-root.
  useEffect(() => {
    if (!open) return;
    setDraft((current) => {
      if (!current) return current;
      if (
        current.app.vault_root_mode === settings.app.vault_root_mode &&
        current.app.upriv_root_path === settings.app.upriv_root_path &&
        current.app.last_opened_vault === settings.app.last_opened_vault
      ) {
        return current;
      }
      return { ...current, app: { ...settings.app } };
    });
  }, [open, settings.app, settings.app.upriv_root_path, settings.app.vault_root_mode]);

  // Keep draft.workspace aligned unless the user edited Workspace this session.
  useEffect(() => {
    if (!open) return;
    if (workspaceTouchedRef.current) return;
    setDraft((current) => {
      if (!current) return current;
      if (workspaceTablesEqual(current.workspace, settings.workspace)) return current;
      return { ...current, workspace: { ...settings.workspace } };
    });
  }, [open, settings.workspace]);

  useEffect(() => {
    if (!open) {
      setResolvedRootPath(null);
      setResolveFailure(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await vaultRootService.resolve({
          vaultRootMode: settings.app.vault_root_mode,
        });
        if (cancelled) return;
        setResolveFailure(null);
        if (resolved.status === "found") {
          setResolvedRootPath(resolved.rootPath);
        } else {
          setResolvedRootPath(null);
          setResolveFailure(vaultRootGoneRpcError());
        }
      } catch (error) {
        if (!cancelled) {
          setResolvedRootPath(null);
          setResolveFailure(error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, settings.app.vault_root_mode, vaultRootService]);

  useEffect(() => {
    if (!open) {
      // A save in flight keeps running; its outcome comes back as a list toast.
      openedSessionRef.current = false;
      workspaceTouchedRef.current = false;
      setDraft(null);
      setDraftShowHiddenVaultsSession(showHiddenVaultsSession);
      setSaveConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
    }
  }, [open, showHiddenVaultsSession]);

  useEffect(() => {
    if (!isDirty) {
      setSaveConfirmOpen(false);
    }
  }, [isDirty]);

  useEffect(() => {
    return () => clearTimeout(savedHideRef.current);
  }, []);

  useEffect(() => {
    if (!saveLimit.timedOut || !saveBusy) return;
    saveBusyGen.current += 1;
    commitSaveLock.current = false;
    setSaveBusy(false);
    setPendingSave(null);
    if (openRef.current) showError(new Error("operation timed out"), "error.operation_timed_out");
    else onNotice?.(t("error.operation_timed_out"));
  }, [saveLimit.timedOut, saveBusy, showError, onNotice, t]);

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
  }, []);

  const patchDraft = useCallback(
    <S extends keyof AppSettingsConfig>(section: S, patch: Partial<AppSettingsConfig[S]>) => {
      if (section === "workspace") {
        workspaceTouchedRef.current = true;
      }
      setDiscardConfirmOpen(false);
      setSaveConfirmOpen(false);
      setDraft((current) =>
        current
          ? {
              ...current,
              [section]: { ...current[section], ...patch },
            }
          : current,
      );
    },
    [],
  );

  const setDraftHiddenSession = useCallback((value: boolean) => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
    setDraftShowHiddenVaultsSession(value);
  }, []);

  const handleClose = () => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  };

  useVaultRootIntegrityClose(open, resolveFailure, reportVaultRootIntegrityFailure, handleClose);

  // Mid-session root loss: Gate reopens Setup — do not leave settings on top.
  // Only close on true→false (had on-disk this session). Bootstrap / failed first load
  // keep `settingsOnDisk === false` and must not auto-dismiss an open modal.
  const hadOnDiskRef = useRef(false);
  useEffect(() => {
    if (settingsOnDisk) hadOnDiskRef.current = true;
  }, [settingsOnDisk]);

  useEffect(() => {
    if (!open || settingsOnDisk || !hadOnDiskRef.current) return;
    saveBusyGen.current += 1;
    commitSaveLock.current = false;
    setDraft(null);
    setSaveBusy(false);
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  }, [open, settingsOnDisk, onClose]);

  const requestClose = () => {
    // Values already being saved are not unsaved.
    if (saveBusy) {
      handleClose();
      return;
    }
    if (discardConfirmOpen || saveConfirmOpen) {
      dismissFooterConfirm();
      return;
    }
    if (isDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    handleClose();
  };

  const handleDiscardAndClose = () => {
    setDraft(settings);
    setDraftShowHiddenVaultsSession(showHiddenVaultsSession);
    handleClose();
  };

  const formConfig = draft ?? settings;
  const workspaceRootForValidation = vaultRootPathForWorkspaceValidation(
    formConfig.app.vault_root_mode,
    formConfig.app.upriv_root_path,
    resolvedRootPath,
  );
  const workspaceSystem = currentWorkspaceSystem();
  const workspacePathInvalid = Boolean(
    validateWorkspaceTable(formConfig.workspace, workspaceRootForValidation),
  );
  /** Open vault + emptied draft must not wipe a configured path for this system. */
  const workspaceClearWhileOpen =
    hasOpenVault &&
    !formConfig.workspace[workspaceSystem].path.trim() &&
    Boolean(settings.workspace[workspaceSystem].path.trim());

  const handleSaveClick = () => {
    if (!isDirty || saveBusy || backupFolderBlocking) return;
    if (workspaceClearWhileOpen) return;
    const workspaceForCheck = workspaceTouchedRef.current
      ? (draft ?? settings).workspace
      : settings.workspace;
    if (validateWorkspaceTable(workspaceForCheck, workspaceRootForValidation)) {
      return;
    }
    dismissFooterConfirm();
    setSaveConfirmOpen(true);
  };

  const commitSave = () => {
    if (!isDirty || saveBusy || backupFolderBlocking) return;
    if (workspaceClearWhileOpen) return;
    const workspaceForSave = workspaceTouchedRef.current
      ? (draft ?? settings).workspace
      : { ...settings.workspace };
    if (validateWorkspaceTable(workspaceForSave, workspaceRootForValidation)) {
      return;
    }
    if (commitSaveLock.current) return;
    const generation = ++saveBusyGen.current;
    commitSaveLock.current = true;
    // Never persist draft vault-root wire fields — Data folder owns those mutations.
    // If Workspace was not edited this session, prefer live Context so Save cannot wipe a newer path.
    const normalized = normalizeAppSettings({
      ...(draft ?? settings),
      app: { ...settings.app },
      workspace: workspaceForSave,
    });
    const showHidden = draftShowHiddenVaultsSession;
    setSaveBusy(true);
    setPendingSave({ config: normalized, showHidden, failure: null });
    let failure: string | null = null;
    void (async () => {
      try {
        if (!appSettingsEqual(normalized, settings)) {
          await replaceSettings(normalized);
          const backupSystem = backupFolderSystem(currentWorkspaceSystem());
          if (backupSystem) {
            const vault = vaultBackupFolders()[backupSystem];
            const leftBehind = backupFolderLeftBehind(
              { app: settings.backups[backupSystem], vault },
              { app: normalized.backups[backupSystem], vault },
            );
            if (leftBehind) onNotice?.(t("toast.backup_folder_changed"));
          }
          if (generation !== saveBusyGen.current) return;
          if (openRef.current) setDraft(normalized);
        }
        if (generation !== saveBusyGen.current) return;
        setShowHiddenVaultsSession(showHidden);
        if (!openRef.current) {
          onNotice?.(t("modal.app_settings.saved_closed"));
          return;
        }
        setSavedVisible(true);
        clearTimeout(savedHideRef.current);
        savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
        setSaveConfirmOpen(false);
      } catch (error) {
        if (generation !== saveBusyGen.current) return;
        setSaveConfirmOpen(false);
        if (shouldBumpVaultRootEpoch(error)) {
          // Context already toasted + bumped Gate epoch; dismiss so Setup/Repair is usable.
          setDraft(settings);
          if (openRef.current) handleClose();
          return;
        }
        const fallback =
          isRpcError(error) && error.code === "invalid_request"
            ? APP_SETTINGS_ERROR_I18N_KEYS.INVALID_REQUEST
            : APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED;
        failure = t(desktopErrorI18nKey(error, fallback));
        if (openRef.current) showError(error, fallback);
        else onNotice?.(failure);
      } finally {
        if (generation === saveBusyGen.current) {
          commitSaveLock.current = false;
          setSaveBusy(false);
          setPendingSave(failure ? { config: normalized, showHidden, failure } : null);
        }
      }
    })();
  };

  const saveBlocked =
    !isDirty ||
    saveBusy ||
    saveConfirmOpen ||
    workspacePathInvalid ||
    workspaceClearWhileOpen ||
    backupFolderBlocking;

  if (!open || !formConfig) return null;

  const footerStatus = discardConfirmOpen ? (
    <p className="text-on-surface-variant">{t("modal.settings.discard_confirm")}</p>
  ) : saveConfirmOpen ? (
    <p className="text-on-surface-variant">{t("modal.app_settings.save_confirm")}</p>
  ) : savedVisible ? (
    <p className="text-vault-open">{t("modal.settings.saved")}</p>
  ) : saveBusy && saveLimit.visible ? (
    <p className="text-on-surface-variant" role="status">
      {t("modal.settings.saving")}
    </p>
  ) : pendingSave?.failure ? (
    <p className="text-on-error-container" role="alert">
      {pendingSave.failure}
    </p>
  ) : null;
  const showFooterStatus = Boolean(footerStatus);

  const footer = (
    <div className={showFooterStatus ? "flex flex-col gap-3" : undefined}>
      {showFooterStatus ? (
        <div className="text-sm" aria-live="polite">
          {footerStatus}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:flex-wrap sm:justify-start [&_button]:w-full sm:[&_button]:w-auto">
        {discardConfirmOpen ? (
          <>
            <Button variant="danger" size="md" onClick={handleDiscardAndClose}>
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
              disabled={saveConfirmOpen ? saveBusy : saveBlocked}
              onClick={saveConfirmOpen ? commitSave : handleSaveClick}
            >
              {saveConfirmOpen ? t("modal.settings.save_confirm_action") : t("modal.settings.save")}
            </Button>
            {saveConfirmOpen ? (
              <Button variant="ghost" size="md" disabled={saveBusy} onClick={dismissFooterConfirm}>
                {t("modal.settings.save_cancel")}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      title={t("modal.app_settings.title")}
      titleIcon="settings"
      onClose={requestClose}
      panelClassName="max-w-3xl"
      footer={footer}
    >
      <div
        className="space-y-1.5 sm:space-y-2"
        onPointerDown={() => {
          if (discardConfirmOpen || saveConfirmOpen) {
            dismissFooterConfirm();
          }
        }}
      >
        {APP_SETTINGS_SECTIONS.map((sectionId) => (
          <VaultSettingsSection
            key={sectionId}
            title={t(`modal.app_settings.section.${sectionId}`)}
          >
            {renderAppSettingsSection(
              sectionId,
              formConfig,
              patchDraft,
              draftShowHiddenVaultsSession,
              setDraftHiddenSession,
              workspaceRootForValidation,
              hasOpenVault,
              settings.backups,
              setBackupFolderBlocking,
            )}
          </VaultSettingsSection>
        ))}
      </div>
    </Modal>
  );
}

function renderAppSettingsSection(
  sectionId: AppSettingsSectionId,
  draft: AppSettingsConfig,
  patchDraft: <S extends keyof AppSettingsConfig>(
    section: S,
    patch: Partial<AppSettingsConfig[S]>,
  ) => void,
  showHiddenVaultsSession: boolean,
  onShowHiddenVaultsSessionChange: (value: boolean) => void,
  workspaceRootForValidation: string | null,
  hasOpenVault: boolean,
  savedBackups: AppSettingsConfig["backups"],
  onBackupFolderBlocking: (blocking: boolean) => void,
) {
  switch (sectionId) {
    case "language":
      return (
        <AppSettingsLanguageSection
          config={draft.ui}
          onChange={(patch) => patchDraft("ui", patch)}
        />
      );
    case "general":
      return (
        <AppSettingsGeneralSection
          config={draft.ui}
          onChange={(patch) => patchDraft("ui", patch)}
        />
      );
    case "workspace":
      return (
        <AppSettingsWorkspaceSection
          config={draft.workspace}
          vaultRootPath={workspaceRootForValidation}
          clearDisabled={hasOpenVault}
          onChange={(patch) => patchDraft("workspace", patch)}
        />
      );
    case "backups":
      return (
        <AppSettingsBackupsSection
          config={draft.backups}
          saved={savedBackups}
          vaultRootPath={workspaceRootForValidation}
          onChange={(patch) => patchDraft("backups", patch)}
          onBlockingChange={onBackupFolderBlocking}
        />
      );
    case "vault_list":
      return (
        <AppSettingsVaultListSection
          config={draft.ui}
          onChange={(patch) => patchDraft("ui", patch)}
        />
      );
    case "groups":
      return (
        <AppSettingsGroupsPrefsSection
          config={draft.ui}
          onChange={(patch) => patchDraft("ui", patch)}
        />
      );
    case "logging":
      return (
        <AppSettingsLoggingSection
          config={draft.logging}
          onChange={(patch) => patchDraft("logging", patch)}
        />
      );
    case "hidden_vaults":
      return (
        <AppSettingsHiddenVaultsSection
          alwaysShowHiddenVaults={draft.ui.always_show_hidden_vaults}
          onAlwaysShowHiddenVaultsChange={(always_show_hidden_vaults) =>
            patchDraft("ui", { always_show_hidden_vaults })
          }
          showHiddenVaultsSession={showHiddenVaultsSession}
          onShowHiddenVaultsSessionChange={onShowHiddenVaultsSessionChange}
        />
      );
    default:
      return null;
  }
}
