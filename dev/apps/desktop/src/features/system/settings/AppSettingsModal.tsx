import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { VaultSettingsSection } from "@/components/settings";
import { useErrorToast } from "@/hooks/useErrorToast";
import { useAppSettingsContext } from "./AppSettingsContext";
import {
  VAULT_ROOT_ALIAS_FILE,
  VAULT_ROOT_ERROR_CODES,
  isRpcError,
  type IncompleteReplacePolicy,
  type NearbyVaultRootStatus,
  type VaultListItem,
} from "@upriv/shared";
import {
  APP_SETTINGS_ERROR_I18N_KEYS,
  APP_SETTINGS_SECTIONS,
  appSettingsEqual,
  normalizeAppSettings,
  type AppSettingsConfig,
  type AppSettingsSectionId,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import {
  AppSettingsAppearanceSection,
  AppSettingsBehaviorSection,
  AppSettingsDownloadVaultsSection,
  AppSettingsHiddenVaultsSection,
  AppSettingsLoggingSection,
} from "./appSettingsForm";

const SAVED_INDICATOR_MS = 1500;

interface AppSettingsModalProps {
  open: boolean;
  onClose: () => void;
  vaults: VaultListItem[];
}

export function AppSettingsModal({ open, onClose, vaults }: AppSettingsModalProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const vaultRoot = useVaultRootService();
  const { settings, replaceSettings, showHiddenVaultsSession, setShowHiddenVaultsSession } =
    useAppSettingsContext();

  const [draft, setDraft] = useState<AppSettingsConfig | null>(null);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [nearbyStatus, setNearbyStatus] = useState<NearbyVaultRootStatus | null>(null);
  /** Fixed-path save hit an incomplete `.upriv/` — offer rename/delete. */
  const [fixedPathRepairOpen, setFixedPathRepairOpen] = useState(false);
  const [fixedPathLoading, setFixedPathLoading] = useState(false);
  const [nearbyStatusEpoch, setNearbyStatusEpoch] = useState(0);
  /** Blocks double-click Save / parallel inspect+commit. */
  const [saveBusy, setSaveBusy] = useState(false);
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedSessionRef = useRef(false);

  const isDirty = useMemo(
    () => Boolean(draft && !appSettingsEqual(draft, settings)),
    [draft, settings],
  );

  /** Fixed → auto: may create or replace nearby `.upriv/` depending on disk status. */
  const switchingToAutoDetect = Boolean(
    draft && !settings.app.auto_detect_vault_root && draft.app.auto_detect_vault_root,
  );

  const autoSwitchWarning: "create" | "replace" | null =
    draft?.app.auto_detect_vault_root && nearbyStatus === "incomplete"
      ? "replace"
      : switchingToAutoDetect && nearbyStatus === "absent"
        ? "create"
        : null;

  const nearbyStatusPending = Boolean(
    open && draft?.app.auto_detect_vault_root && nearbyStatus === null,
  );
  const nearbyUnreadable = draft?.app.auto_detect_vault_root && nearbyStatus === "unreadable";

  useEffect(() => {
    const wantsAuto = Boolean(open && draft?.app.auto_detect_vault_root);
    if (!wantsAuto) {
      setNearbyStatus(null);
      return;
    }
    let cancelled = false;
    void vaultRoot
      .nearbyStatus()
      .then((result) => {
        if (!cancelled) setNearbyStatus(result.status);
      })
      .catch(() => {
        if (!cancelled) setNearbyStatus("unreadable");
      });
    return () => {
      cancelled = true;
    };
  }, [open, draft?.app.auto_detect_vault_root, vaultRoot, nearbyStatusEpoch]);

  const retryNearbyStatus = useCallback(() => {
    setNearbyStatus(null);
    setNearbyStatusEpoch((n) => n + 1);
  }, []);

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
      setDeleteConfirmOpen(false);
      setFixedPathRepairOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
      setFixedPathLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!isDirty) {
      setSaveConfirmOpen(false);
      setDeleteConfirmOpen(false);
      setFixedPathRepairOpen(false);
    }
  }, [isDirty]);

  useEffect(() => {
    return () => clearTimeout(savedHideRef.current);
  }, []);

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
    setDeleteConfirmOpen(false);
    setFixedPathRepairOpen(false);
  }, []);

  const patchDraft = useCallback(
    <S extends keyof AppSettingsConfig>(section: S, patch: Partial<AppSettingsConfig[S]>) => {
      setDiscardConfirmOpen(false);
      setSaveConfirmOpen(false);
      setDeleteConfirmOpen(false);
      setFixedPathRepairOpen(false);
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
    setDeleteConfirmOpen(false);
    setFixedPathRepairOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  };

  const requestClose = () => {
    if (discardConfirmOpen || saveConfirmOpen || deleteConfirmOpen || fixedPathRepairOpen) {
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
    if (nearbyStatusPending || nearbyUnreadable) {
      if (nearbyUnreadable) {
        showError(null, "modal.vault_root_setup.error_io");
      }
      return;
    }
    dismissFooterConfirm();

    const normalized = normalizeAppSettings(draft);
    // Same as auto→incomplete nearby: first Save opens repair (skip generic confirm).
    if (!normalized.app.auto_detect_vault_root) {
      const path = normalized.app.upriv_root_path.trim();
      if (path) {
        setSaveBusy(true);
        void vaultRoot
          .inspectAtPath(path)
          .then((result) => {
            if (result.status === "incomplete") {
              setFixedPathRepairOpen(true);
              return;
            }
            if (result.status === "unreadable") {
              showError(null, "modal.vault_root_setup.error_io");
              return;
            }
            setSaveConfirmOpen(true);
          })
          .catch((error) => {
            showError(error, APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED);
          })
          .finally(() => setSaveBusy(false));
        return;
      }
    }

    // Auto + incomplete: open rename/delete actions (do not generic-confirm into silent replace).
    if (normalized.app.auto_detect_vault_root && nearbyStatus === "incomplete") {
      setSaveConfirmOpen(true);
      return;
    }

    setSaveConfirmOpen(true);
  };

  const showIncompleteRepairActions =
    fixedPathRepairOpen || (saveConfirmOpen && autoSwitchWarning === "replace");

  const commitSave = (replacePolicy?: IncompleteReplacePolicy) => {
    if (!draft || !isDirty || saveBusy) return;
    const normalized = normalizeAppSettings(draft);
    setSaveBusy(true);
    void replaceSettings(normalized, replacePolicy ? { replacePolicy } : undefined)
      .then(() => {
        setDraft(normalized);
        setSavedVisible(true);
        clearTimeout(savedHideRef.current);
        savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
        setSaveConfirmOpen(false);
        setDeleteConfirmOpen(false);
        setFixedPathRepairOpen(false);
      })
      .catch((error) => {
        const incomplete =
          (isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) ||
          (error instanceof Error &&
            (error.message === VAULT_ROOT_ERROR_CODES.INCOMPLETE ||
              error.message.includes(`${VAULT_ROOT_ERROR_CODES.INCOMPLETE}:`)));
        if (incomplete && !normalized.app.auto_detect_vault_root) {
          setSaveConfirmOpen(false);
          setDeleteConfirmOpen(false);
          setFixedPathRepairOpen(true);
          return;
        }
        if (incomplete && normalized.app.auto_detect_vault_root) {
          setNearbyStatus("incomplete");
          setFixedPathRepairOpen(false);
          setDeleteConfirmOpen(false);
          setSaveConfirmOpen(true);
          return;
        }
        setSaveConfirmOpen(false);
        setDeleteConfirmOpen(false);
        setFixedPathRepairOpen(false);
        showError(error, APP_SETTINGS_ERROR_I18N_KEYS.SAVE_FAILED);
      })
      .finally(() => setSaveBusy(false));
  };

  const formConfig = draft ?? settings;
  const fixedPathNeedsFolder =
    Boolean(draft) && !draft!.app.auto_detect_vault_root && !draft!.app.upriv_root_path.trim();
  const saveBlocked =
    !isDirty ||
    saveBusy ||
    saveConfirmOpen ||
    deleteConfirmOpen ||
    fixedPathRepairOpen ||
    fixedPathLoading ||
    fixedPathNeedsFolder ||
    nearbyStatusPending ||
    Boolean(nearbyUnreadable);

  if (!open || !formConfig) return null;

  const footer = (
    <div className="flex flex-col gap-3">
      <div className="min-h-[1.25rem] text-sm" aria-live="polite">
        {discardConfirmOpen ? (
          <p className="text-on-surface-variant">{t("modal.settings.discard_confirm")}</p>
        ) : deleteConfirmOpen ? (
          <p className="text-on-surface-variant" role="alert">
            {t("modal.app_settings.save_confirm_switch_auto_replace_delete_body")}
          </p>
        ) : fixedPathRepairOpen ? (
          <p className="text-on-surface-variant">
            {t("modal.app_settings.save_confirm_fixed_incomplete", {
              path: formConfig.app.upriv_root_path.trim() || "…",
            })}
          </p>
        ) : saveConfirmOpen ? (
          <p className="text-on-surface-variant">
            {autoSwitchWarning === "create"
              ? t("modal.app_settings.save_confirm_switch_auto_create", {
                  file: VAULT_ROOT_ALIAS_FILE,
                })
              : autoSwitchWarning === "replace"
                ? t("modal.app_settings.save_confirm_switch_auto_replace", {
                    file: VAULT_ROOT_ALIAS_FILE,
                  })
                : t("modal.app_settings.save_confirm")}
          </p>
        ) : savedVisible ? (
          <p className="text-vault-open">{t("modal.settings.saved")}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&_button]:w-full sm:[&_button]:w-auto">
        {discardConfirmOpen ? (
          <>
            <Button variant="ghost" size="md" onClick={dismissFooterConfirm}>
              {t("modal.settings.discard_keep_editing")}
            </Button>
            <Button variant="danger" size="md" onClick={handleDiscardAndClose}>
              {t("modal.settings.discard_confirm_action")}
            </Button>
          </>
        ) : deleteConfirmOpen ? (
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setDeleteConfirmOpen(false);
                if (!fixedPathRepairOpen) setSaveConfirmOpen(true);
              }}
            >
              {t("action.back")}
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={saveBusy}
              onClick={() => commitSave("delete")}
            >
              {t("modal.app_settings.save_confirm_switch_auto_replace_delete_confirm")}
            </Button>
          </>
        ) : showIncompleteRepairActions ? (
          <>
            <Button variant="ghost" size="md" disabled={saveBusy} onClick={dismissFooterConfirm}>
              {t("modal.settings.save_cancel")}
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={saveBusy}
              onClick={() => commitSave("rename")}
            >
              {t("modal.app_settings.save_confirm_switch_auto_replace_rename")}
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={saveBusy}
              onClick={() => {
                setSaveConfirmOpen(false);
                setDeleteConfirmOpen(true);
              }}
            >
              {t("modal.app_settings.save_confirm_switch_auto_replace_delete")}
            </Button>
          </>
        ) : saveConfirmOpen ? (
          <>
            <Button variant="ghost" size="md" disabled={saveBusy} onClick={dismissFooterConfirm}>
              {t("modal.settings.save_cancel")}
            </Button>
            <Button variant="primary" size="md" disabled={saveBusy} onClick={() => commitSave()}>
              {t("modal.settings.save_confirm_action")}
            </Button>
          </>
        ) : null}
        <Button variant="primary" size="md" disabled={saveBlocked} onClick={handleSaveClick}>
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
          if (discardConfirmOpen || saveConfirmOpen || deleteConfirmOpen || fixedPathRepairOpen) {
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
              switchingToAutoDetect,
              autoSwitchWarning,
              fixedPathLoading,
              setFixedPathLoading,
              Boolean(nearbyUnreadable),
              retryNearbyStatus,
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
  _switchingToAutoDetect: boolean,
  autoSwitchWarning: "create" | "replace" | null,
  fixedPathLoading: boolean,
  setFixedPathLoading: (loading: boolean) => void,
  nearbyUnreadable: boolean,
  onRetryNearbyStatus: () => void,
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
          autoSwitchWarning={autoSwitchWarning}
          fixedPathLoading={fixedPathLoading}
          onFixedPathLoadingChange={setFixedPathLoading}
          nearbyUnreadable={nearbyUnreadable}
          onRetryNearbyStatus={onRetryNearbyStatus}
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
