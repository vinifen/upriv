import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { VaultSettingsSection } from "@/components/settings";
import { useErrorToast } from "@/hooks/useErrorToast";
import { useAppSettingsContext } from "./AppSettingsContext";
import {
  APP_SETTINGS_ERROR_I18N_KEYS,
  APP_SETTINGS_SECTIONS,
  VAULT_DISPLAY_NAME_MAX_LENGTH,
  appSettingsEqual,
  displayNameErrorI18nKey,
  isRpcError,
  isVaultRootErrorCode,
  normalizeAppSettings,
  validateDisplayName,
  type AppSettingsConfig,
  type AppSettingsSectionId,
  type VaultGroup,
  type VaultListItem,
} from "@upriv/shared";
import {
  AppSettingsAppearanceSection,
  AppSettingsDownloadVaultsSection,
  AppSettingsGroupsSection,
  AppSettingsHiddenVaultsSection,
  AppSettingsLoggingSection,
} from "./appSettingsForm";

const SAVED_INDICATOR_MS = 1500;

interface AppSettingsModalProps {
  open: boolean;
  onClose: () => void;
  vaults: VaultListItem[];
  groups?: VaultGroup[];
  includeHidden?: boolean;
  onCreateGroup?: (displayName: string, groupedVaultIds: string[]) => Promise<void> | void;
  /** Report unsaved draft so the list shell can refuse opening Data folder. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * System settings for the **active** vault-root (appearance, logging, …).
 * Data-folder switch lives in `VaultRootDataFolderModal` (⋯ menu) — separate context.
 */
export function AppSettingsModal({
  open,
  onClose,
  vaults,
  groups = [],
  includeHidden = false,
  onCreateGroup,
  onDirtyChange,
}: AppSettingsModalProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const {
    settings,
    replaceSettings,
    showHiddenVaultsSession,
    setShowHiddenVaultsSession,
    settingsOnDisk,
  } = useAppSettingsContext();

  const [draft, setDraft] = useState<AppSettingsConfig | null>(null);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupedVaultIds, setGroupedVaultIds] = useState<string[]>([]);
  const [groupNameError, setGroupNameError] = useState<string | null>(null);
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedSessionRef = useRef(false);

  const pendingGroupName = newGroupName.trim();
  const isDirty = useMemo(() => {
    const settingsDirty = Boolean(draft && !appSettingsEqual(draft, settings));
    return settingsDirty || pendingGroupName.length > 0;
  }, [draft, pendingGroupName, settings]);

  useEffect(() => {
    onDirtyChange?.(open && isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange, open]);

  useEffect(() => {
    if (!open) return;
    if (openedSessionRef.current) return;
    openedSessionRef.current = true;
    setDraft(settings);
    setNewGroupName("");
    setGroupedVaultIds([]);
    setGroupNameError(null);
  }, [open, settings]);

  // Keep draft.app aligned with live Context so Save never sends a stale vault-root.
  useEffect(() => {
    if (!open) return;
    setDraft((current) => {
      if (!current) return current;
      if (
        current.app.vault_root_mode === settings.app.vault_root_mode &&
        current.app.upriv_root_path === settings.app.upriv_root_path
      ) {
        return current;
      }
      return { ...current, app: { ...settings.app } };
    });
  }, [open, settings.app, settings.app.upriv_root_path, settings.app.vault_root_mode]);

  useEffect(() => {
    if (!open) {
      openedSessionRef.current = false;
      setDraft(null);
      setNewGroupName("");
      setGroupedVaultIds([]);
      setGroupNameError(null);
      setSaveConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
    }
  }, [open]);

  useEffect(() => {
    if (!isDirty) {
      setSaveConfirmOpen(false);
    }
  }, [isDirty]);

  useEffect(() => {
    return () => clearTimeout(savedHideRef.current);
  }, []);

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

  const handleClose = () => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  };

  // Mid-session root loss: Gate reopens Setup/Repair — do not leave settings on top.
  // Only close on true→false (had on-disk this session). Bootstrap / failed first load
  // keep `settingsOnDisk === false` and must not auto-dismiss an open modal.
  const hadOnDiskRef = useRef(false);
  useEffect(() => {
    if (settingsOnDisk) hadOnDiskRef.current = true;
  }, [settingsOnDisk]);

  useEffect(() => {
    if (!open || settingsOnDisk || !hadOnDiskRef.current) return;
    setDraft(null);
    setSaveBusy(false);
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  }, [open, settingsOnDisk, onClose]);

  const requestClose = () => {
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
    setNewGroupName("");
    setGroupedVaultIds([]);
    setGroupNameError(null);
    handleClose();
  };

  const handleSaveClick = () => {
    if (!isDirty || !draft || saveBusy) return;
    if (pendingGroupName) {
      const validation = validateDisplayName(pendingGroupName);
      if (validation) {
        setGroupNameError(
          t(
            displayNameErrorI18nKey(validation),
            validation === "too_long"
              ? { max: String(VAULT_DISPLAY_NAME_MAX_LENGTH) }
              : undefined,
          ),
        );
        return;
      }
    }
    setGroupNameError(null);
    dismissFooterConfirm();
    setSaveConfirmOpen(true);
  };

  const commitSaveLock = useRef(false);

  const commitSave = () => {
    if (!draft || !isDirty || saveBusy) return;
    if (commitSaveLock.current) return;
    commitSaveLock.current = true;
    // Never persist draft vault-root wire fields — Data folder owns those mutations.
    const normalized = normalizeAppSettings({
      ...draft,
      app: { ...settings.app },
    });
    setSaveBusy(true);
    void (async () => {
      try {
        if (draft && !appSettingsEqual(draft, settings)) {
          await replaceSettings(normalized);
          setDraft(normalized);
        }
        if (pendingGroupName) {
          await onCreateGroup?.(pendingGroupName, groupedVaultIds);
          setNewGroupName("");
          setGroupedVaultIds([]);
        }
        setSavedVisible(true);
        clearTimeout(savedHideRef.current);
        savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
        setSaveConfirmOpen(false);
      } catch (error) {
        setSaveConfirmOpen(false);
        if (isRpcError(error) && isVaultRootErrorCode(error.code)) {
          // Context already toasted + bumped Gate epoch; dismiss so Setup/Repair is usable.
          setDraft(settings);
          handleClose();
          return;
        }
        const fallback =
          isRpcError(error) && error.code === "invalid_request"
            ? APP_SETTINGS_ERROR_I18N_KEYS.INVALID_REQUEST
            : APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED;
        showError(error, fallback);
      } finally {
        commitSaveLock.current = false;
        setSaveBusy(false);
      }
    })();
  };

  const formConfig = draft ?? settings;
  const saveBlocked = !isDirty || saveBusy || saveConfirmOpen;

  if (!open || !formConfig) return null;

  const footer = (
    <div className="flex flex-col gap-3">
      <div className="text-sm" aria-live="polite">
        {discardConfirmOpen ? (
          <p className="text-on-surface-variant">{t("modal.settings.discard_confirm")}</p>
        ) : saveConfirmOpen ? (
          <p className="text-on-surface-variant">{t("modal.app_settings.save_confirm")}</p>
        ) : savedVisible ? (
          <p className="text-vault-open">{t("modal.settings.saved")}</p>
        ) : null}
      </div>
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
            defaultOpen={sectionId === "appearance"}
          >
            {renderAppSettingsSection(
              sectionId,
              formConfig,
              patchDraft,
              showHiddenVaultsSession,
              setShowHiddenVaultsSession,
              vaults,
              open,
              {
                groups,
                includeHidden,
                newGroupName,
                groupedVaultIds,
                nameError: groupNameError,
                onNewGroupNameChange: (name) => {
                  setNewGroupName(name);
                  setGroupNameError(null);
                  setSaveConfirmOpen(false);
                  setDiscardConfirmOpen(false);
                },
                onToggleGroupedVault: (vaultId) => {
                  setGroupedVaultIds((current) =>
                    current.includes(vaultId)
                      ? current.filter((id) => id !== vaultId)
                      : [...current, vaultId],
                  );
                  setSaveConfirmOpen(false);
                  setDiscardConfirmOpen(false);
                },
              },
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
  setShowHiddenVaultsSession: (value: boolean) => void,
  vaults: VaultListItem[],
  modalOpen: boolean,
  groupsDraft: {
    groups: VaultGroup[];
    includeHidden: boolean;
    newGroupName: string;
    groupedVaultIds: string[];
    nameError: string | null;
    onNewGroupNameChange: (name: string) => void;
    onToggleGroupedVault: (vaultId: string) => void;
  },
) {
  switch (sectionId) {
    case "appearance":
      return (
        <AppSettingsAppearanceSection
          config={draft.ui}
          onChange={(patch) => patchDraft("ui", patch)}
        />
      );
    case "groups":
      return (
        <AppSettingsGroupsSection
          config={draft.ui}
          onChange={(patch) => patchDraft("ui", patch)}
          vaults={vaults}
          groups={groupsDraft.groups}
          includeHidden={groupsDraft.includeHidden}
          newGroupName={groupsDraft.newGroupName}
          groupedVaultIds={groupsDraft.groupedVaultIds}
          nameError={groupsDraft.nameError}
          onNewGroupNameChange={groupsDraft.onNewGroupNameChange}
          onToggleGroupedVault={groupsDraft.onToggleGroupedVault}
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
          onShowHiddenVaultsSessionChange={setShowHiddenVaultsSession}
        />
      );
    case "download_vaults":
      return <AppSettingsDownloadVaultsSection vaults={vaults} modalOpen={modalOpen} />;
    default:
      return null;
  }
}
