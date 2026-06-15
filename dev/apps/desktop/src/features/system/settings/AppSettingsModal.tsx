import {
useCallback,
useEffect,
useMemo,
useRef,
useState
} from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { VaultSettingsSection } from "@/components/settings";
import { useAppSettingsContext } from "./AppSettingsContext";
import type { VaultListItem } from "@upriv/shared";
import {
  AppSettingsAppearanceSection,
  AppSettingsBehaviorSection,
  AppSettingsDownloadVaultsSection,
  AppSettingsHiddenVaultsSection,
  AppSettingsLoggingSection,
} from "./appSettingsForm";
import {
  APP_SETTINGS_SECTIONS,
  appSettingsEqual,
  normalizeAppSettings,
  type AppSettingsConfig,
  type AppSettingsSectionId,
} from "@upriv/shared";

const SAVED_INDICATOR_MS = 1500;

interface AppSettingsModalProps {
  open: boolean;
  onClose: () => void;
  vaults: VaultListItem[];
}

export function AppSettingsModal({ open, onClose, vaults }: AppSettingsModalProps) {
  const { t } = useTranslation();
  const { settings, replaceSettings, showHiddenVaultsSession, setShowHiddenVaultsSession } =
    useAppSettingsContext();

  const [draft, setDraft] = useState<AppSettingsConfig | null>(null);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedSessionRef = useRef(false);

  const isDirty = useMemo(
    () => Boolean(draft && !appSettingsEqual(draft, settings)),
    [draft, settings],
  );

  useEffect(() => {
    if (!open) return;
    if (openedSessionRef.current) return;
    openedSessionRef.current = true;
    setDraft(settings);
  }, [open, settings]);

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
    if (!isDirty) setSaveConfirmOpen(false);
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
    if (!isDirty) return;
    dismissFooterConfirm();
    setSaveConfirmOpen(true);
  };

  const handleConfirmSave = () => {
    if (!draft || !isDirty) return;
    const normalized = normalizeAppSettings(draft);
    void replaceSettings(normalized)
      .then(() => {
        setDraft(normalized);
        setSavedVisible(true);
        clearTimeout(savedHideRef.current);
        savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
        setSaveConfirmOpen(false);
      })
      .catch(() => {
        setSaveConfirmOpen(false);
      });
  };

  const formConfig = draft ?? settings;
  if (!open || !formConfig) return null;

  const footer = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-h-[1.25rem] text-sm" aria-live="polite">
        {discardConfirmOpen ? (
          <p className="text-on-surface-variant">{t("modal.settings.discard_confirm")}</p>
        ) : saveConfirmOpen ? (
          <p className="text-on-surface-variant">{t("modal.app_settings.save_confirm")}</p>
        ) : savedVisible ? (
          <p className="text-vault-open">{t("modal.settings.saved")}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&_button]:w-full sm:[&_button]:w-auto">
        {discardConfirmOpen ? (
          <>
            <Button variant="ghost" size="md" onClick={dismissFooterConfirm}>
              {t("modal.settings.discard_keep_editing")}
            </Button>
            <Button variant="danger" size="md" onClick={handleDiscardAndClose}>
              {t("modal.settings.discard_confirm_action")}
            </Button>
          </>
        ) : saveConfirmOpen ? (
          <>
            <Button variant="ghost" size="md" onClick={dismissFooterConfirm}>
              {t("modal.settings.save_cancel")}
            </Button>
            <Button variant="primary" size="md" onClick={handleConfirmSave}>
              {t("modal.settings.save_confirm_action")}
            </Button>
          </>
        ) : null}
        <Button
          variant="primary"
          size="md"
          disabled={!isDirty || saveConfirmOpen}
          onClick={handleSaveClick}
        >
          {t("modal.settings.save")}
        </Button>
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
          if (discardConfirmOpen || saveConfirmOpen) dismissFooterConfirm();
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
    case "behavior":
      return (
        <AppSettingsBehaviorSection
          config={draft.app}
          onChange={(patch) => patchDraft("app", patch)}
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
