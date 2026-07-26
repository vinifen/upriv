import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { VaultSettingsSection } from "@/components/settings";
import { useErrorToast } from "@/hooks/useErrorToast";
import { useAppSettingsContext } from "./AppSettingsContext";
import {
  APP_SETTINGS_ERROR_I18N_KEYS,
  APP_SETTINGS_SECTIONS,
  appSettingsEqual,
  isRpcError,
  normalizeAppSettings,
  type AppSettingsConfig,
  type AppSettingsSectionId,
  type VaultListItem,
} from "@upriv/shared";
import {
  AppSettingsAppearanceSection,
  AppSettingsDownloadVaultsSection,
  AppSettingsHiddenVaultsSection,
  AppSettingsLoggingSection,
} from "./appSettingsForm";

const SAVED_INDICATOR_MS = 1500;

interface AppSettingsModalProps {
  open: boolean;
  onClose: () => void;
  vaults: VaultListItem[];
  /** Report unsaved draft so the list shell can refuse opening Data folder. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * System settings for the **active** vault-root (appearance, logging, …).
 * Data-folder switch lives in `VaultRootDataFolderModal` (⋯ menu) — separate context.
 */
export function AppSettingsModal({ open, onClose, vaults, onDirtyChange }: AppSettingsModalProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const { settings, replaceSettings, showHiddenVaultsSession, setShowHiddenVaultsSession } =
    useAppSettingsContext();

  const [draft, setDraft] = useState<AppSettingsConfig | null>(null);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedSessionRef = useRef(false);

  const isDirty = useMemo(() => {
    if (!draft) return false;
    // Ignores wire `app` (Data folder owns vault-root) — see `appSettingsEqual`.
    return !appSettingsEqual(draft, settings);
  }, [draft, settings]);

  useEffect(() => {
    onDirtyChange?.(open && isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange, open]);

  useEffect(() => {
    if (!open) return;
    if (openedSessionRef.current) return;
    openedSessionRef.current = true;
    setDraft(settings);
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
    handleClose();
  };

  const handleSaveClick = () => {
    if (!isDirty || !draft || saveBusy) return;
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
    void replaceSettings(normalized)
      .then(() => {
        setDraft(normalized);
        setSavedVisible(true);
        clearTimeout(savedHideRef.current);
        savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
        setSaveConfirmOpen(false);
      })
      .catch((error) => {
        setSaveConfirmOpen(false);
        const fallback =
          isRpcError(error) && error.code === "invalid_request"
            ? APP_SETTINGS_ERROR_I18N_KEYS.INVALID_REQUEST
            : APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED;
        showError(error, fallback);
      })
      .finally(() => {
        commitSaveLock.current = false;
        setSaveBusy(false);
      });
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
) {
  switch (sectionId) {
    case "appearance":
      return (
        <AppSettingsAppearanceSection
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
          onShowHiddenVaultsSessionChange={setShowHiddenVaultsSession}
        />
      );
    case "download_vaults":
      return <AppSettingsDownloadVaultsSection vaults={vaults} modalOpen={modalOpen} />;
    default:
      return null;
  }
}
