import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { VaultSettingsSection } from "@/components/settings";
import { useErrorToast } from "@/hooks/useErrorToast";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import {
  hereDevice,
  useDeviceInfo,
  useOperationLimit,
  useVaultRootIntegrityClose,
} from "@upriv/shared/react";
import { useDeviceService, useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import {
  APP_BACKUP_LIST,
  APP_SETTINGS_ERROR_I18N_KEYS,
  APP_SETTINGS_SECTIONS,
  APP_UNLOCKED_LIST,
  appListChanges,
  appSettingsEqual,
  appUnlockedFixedFolders,
  isRpcError,
  encryptedFolderUnchosen,
  listDraftBlocks,
  shouldBumpVaultRootEpoch,
  normalizeAppSettings,
  vaultRootGoneRpcError,
  type AppSettingsConfig,
  type AppSettingsSectionId,
  type HereDevice,
  type ListsSaved,
} from "@upriv/shared";
import {
  AppSettingsBackupsSection,
  AppSettingsGeneralSection,
  AppSettingsGroupsPrefsSection,
  AppSettingsHiddenVaultsSection,
  AppSettingsLanguageSection,
  AppSettingsLoggingSection,
  AppSettingsUnlockedFoldersSection,
  AppSettingsVaultListSection,
} from "./appSettingsForm";

const SAVED_INDICATOR_MS = 1500;

interface AppSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Report unsaved draft so the list shell can refuse opening Data folder. */
  onDirtyChange?: (dirty: boolean) => void;
  /** A vault is open: this device's unlocked folders keep their rows and choice. */
  hasOpenVault?: boolean;
  /** List toast. A save keeps running after the window closes and reports here. */
  onNotice?: (message: string) => void;
  /** A vault's display name, by id, for the save's toasts. */
  vaultName?: (vaultId: string) => string;
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
  vaultName = (vaultId) => vaultId,
}: AppSettingsModalProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const openRef = useRef(open);
  openRef.current = open;
  const vaultRootService = useVaultRootService();
  const here = hereDevice(useDeviceInfo(useDeviceService()));
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
  const [resolvedRootPath, setResolvedRootPath] = useState<string | null>(null);
  const [resolveFailure, setResolveFailure] = useState<unknown>(null);
  /**
   * The settings as the window opened, or as the last save left them. A save
   * sends the lists' change from here, so a switch core made meanwhile stays.
   */
  const [baseline, setBaseline] = useState<AppSettingsConfig | null>(null);
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedSessionRef = useRef(false);
  const commitSaveLock = useRef(false);
  /** Bumped only when a save runs past `OPERATION_LIMIT_MS`; closing never drops a result. */
  const saveBusyGen = useRef(0);
  const saveLimit = useOperationLimit(saveBusy);
  const [pendingSave, setPendingSave] = useState<PendingAppSave | null>(null);
  const pendingSaveRef = useRef(pendingSave);
  pendingSaveRef.current = pendingSave;

  const isDirty = useMemo(
    () =>
      Boolean(draft && !appSettingsEqual(draft, baseline ?? settings)) ||
      draftShowHiddenVaultsSession !== showHiddenVaultsSession,
    [baseline, draft, draftShowHiddenVaultsSession, settings, showHiddenVaultsSession],
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
    setBaseline(settings);
    setDraft(pending?.config ?? settings);
    setDraftShowHiddenVaultsSession(pending?.showHidden ?? showHiddenVaultsSession);
  }, [open, settings, showHiddenVaultsSession]);

  // `[app]` is core's: keep the draft on the live value.
  useEffect(() => {
    if (!open) return;
    setDraft((current) => {
      if (!current) return current;
      if (current.app.last_opened_vault === settings.app.last_opened_vault) return current;
      return { ...current, app: { ...settings.app } };
    });
  }, [open, settings.app]);

  useEffect(() => {
    if (!open) {
      setResolvedRootPath(null);
      setResolveFailure(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await vaultRootService.resolve();
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
  }, [open, vaultRootService]);

  useEffect(() => {
    if (!open) {
      // A save in flight keeps running; its outcome comes back as a list toast.
      openedSessionRef.current = false;
      setDraft(null);
      setBaseline(null);
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
  const listBase = baseline ?? settings;
  const hereId = here?.id ?? null;
  // Save waits only when this draft leaves encrypted vaults with no folder here, so
  // a switch another device turned on never holds an unrelated save.
  const unlockedUnchosen =
    encryptedFolderUnchosen(formConfig.unlocked_folders, null, here) &&
    !encryptedFolderUnchosen(listBase.unlocked_folders, null, here);
  const listsBlocked =
    unlockedUnchosen ||
    // The same rows the list marks: a row may not repeat Beside the data folder.
    listDraftBlocks(
      listBase.unlocked_folders.devices,
      formConfig.unlocked_folders.devices,
      APP_UNLOCKED_LIST,
      hereId,
      here ? appUnlockedFixedFolders(here.system, resolvedRootPath) : [],
    ) ||
    listDraftBlocks(listBase.backups.devices, formConfig.backups.devices, APP_BACKUP_LIST, hereId);

  const handleSaveClick = () => {
    if (!isDirty || saveBusy || listsBlocked) return;
    dismissFooterConfirm();
    setSaveConfirmOpen(true);
  };

  const commitSave = () => {
    if (!isDirty || saveBusy || listsBlocked) return;
    if (commitSaveLock.current) return;
    const generation = ++saveBusyGen.current;
    commitSaveLock.current = true;
    const normalized = normalizeAppSettings({ ...(draft ?? settings), app: { ...settings.app } });
    // This device's unlocked folders keep their rows while a vault is open (`no_open_session`).
    const lists = appListChanges(listBase, normalized, hereId, { unlockedHere: hasOpenVault });
    const showHidden = draftShowHiddenVaultsSession;
    setSaveBusy(true);
    setPendingSave({ config: normalized, showHidden, failure: null });
    let failure: string | null = null;
    void (async () => {
      try {
        if (!appSettingsEqual(normalized, listBase)) {
          const saved = await replaceSettings(normalized, { lists });
          reportListsSaved(saved);
          if (generation !== saveBusyGen.current) return;
          if (openRef.current) {
            setDraft(normalized);
            setBaseline(normalized);
          }
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

  /** What a save left beyond `settings.toml`: folders that stayed, vaults that kept a device name. */
  function reportListsSaved(saved: ListsSaved) {
    for (const folder of saved.keptFolders) {
      onNotice?.(t("folder_list.toast.folder_kept", { path: folder }));
    }
    if (saved.unchangedVaults.length > 0) {
      onNotice?.(
        t("folder_list.toast.vaults_unchanged", {
          names: saved.unchangedVaults.map(vaultName).join(", "),
        }),
      );
    }
  }

  const saveBlocked = !isDirty || saveBusy || saveConfirmOpen || listsBlocked;

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
            {renderAppSettingsSection(sectionId, formConfig, patchDraft, {
              showHiddenVaultsSession: draftShowHiddenVaultsSession,
              onShowHiddenVaultsSessionChange: setDraftHiddenSession,
              saved: listBase,
              here,
              vaultRootPath: resolvedRootPath,
              unlockedLockedHint: hasOpenVault
                ? t("modal.app_settings.field.unlocked_folders.locked")
                : null,
            })}
          </VaultSettingsSection>
        ))}
      </div>
    </Modal>
  );
}

interface SectionContext {
  showHiddenVaultsSession: boolean;
  onShowHiddenVaultsSessionChange: (value: boolean) => void;
  /** The settings the lists' change is sent from. */
  saved: AppSettingsConfig;
  here: HereDevice | null;
  vaultRootPath: string | null;
  unlockedLockedHint: string | null;
}

function renderAppSettingsSection(
  sectionId: AppSettingsSectionId,
  draft: AppSettingsConfig,
  patchDraft: <S extends keyof AppSettingsConfig>(
    section: S,
    patch: Partial<AppSettingsConfig[S]>,
  ) => void,
  context: SectionContext,
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
    case "unlocked_folders":
      return (
        <AppSettingsUnlockedFoldersSection
          config={draft.unlocked_folders}
          saved={context.saved.unlocked_folders}
          here={context.here}
          vaultRootPath={context.vaultRootPath}
          lockedHint={context.unlockedLockedHint}
          onChange={(patch) => patchDraft("unlocked_folders", patch)}
        />
      );
    case "backups":
      return (
        <AppSettingsBackupsSection
          config={draft.backups}
          saved={context.saved.backups}
          here={context.here}
          onChange={(patch) => patchDraft("backups", patch)}
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
          showHiddenVaultsSession={context.showHiddenVaultsSession}
          onShowHiddenVaultsSessionChange={context.onShowHiddenVaultsSessionChange}
        />
      );
    default:
      return null;
  }
}
