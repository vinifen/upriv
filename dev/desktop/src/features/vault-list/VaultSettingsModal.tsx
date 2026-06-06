import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { vaultSettingsToListPatch } from "./mockVaultSettings";
import { VaultSettingsSection } from "./VaultSettingsSection";
import type { VaultListItem } from "./types";
import { useVaultSettings } from "./useVaultSettings";
import {
  VaultSettingsBackupSection,
  VaultSettingsCloseSection,
  VaultSettingsDangerZoneSection,
  VaultSettingsPolicySection,
  VaultSettingsSecuritySection,
  VaultSettingsSevenZipSection,
  VaultSettingsStorageSection,
  VaultSettingsVaultSection,
} from "./vaultSettingsForm";
import type { VaultSettingsConfig, VaultSettingsListPatch, VaultSettingsSectionId } from "./vaultSettingsTypes";
import { normalizeSecurityModeForStorage, VAULT_SETTINGS_SECTIONS, vaultSettingsEqual } from "./vaultSettingsTypes";

const SAVED_INDICATOR_MS = 1500;

interface VaultSettingsModalProps {
  vault: VaultListItem | null;
  open: boolean;
  onClose: () => void;
  onVaultSettingsSaved?: (vaultId: string, patch: VaultSettingsListPatch) => void;
  onVaultDelete?: (vaultId: string) => void;
}

export function VaultSettingsModal({
  vault,
  open,
  onClose,
  onVaultSettingsSaved,
  onVaultDelete,
}: VaultSettingsModalProps) {
  const { t } = useTranslation();
  const vaultId = vault?.id ?? null;
  const { config, replaceConfig } = useVaultSettings(vaultId, open);

  const [draft, setDraft] = useState<VaultSettingsConfig | null>(null);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const confirmInputId = useId();
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();

  const canConfirmDelete = vault !== null && deleteConfirm.trim() === vault.id;

  const isDirty = useMemo(
    () => Boolean(draft && config && !vaultSettingsEqual(draft, config)),
    [draft, config],
  );

  useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setSaveConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setSavedVisible(false);
      setDeleteOpen(false);
      setDeleteConfirm("");
    }
  }, [open, vaultId]);

  useEffect(() => {
    if (!isDirty) setSaveConfirmOpen(false);
  }, [isDirty]);

  useEffect(() => {
    return () => clearTimeout(savedHideRef.current);
  }, []);

  const persistDraft = useCallback(
    (next: VaultSettingsConfig) => {
      if (!vaultId) return;
      replaceConfig(next);
      onVaultSettingsSaved?.(vaultId, vaultSettingsToListPatch(next));
      setSavedVisible(true);
      clearTimeout(savedHideRef.current);
      savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
    },
    [vaultId, replaceConfig, onVaultSettingsSaved],
  );

  const dismissFooterConfirm = useCallback(() => {
    setDiscardConfirmOpen(false);
    setSaveConfirmOpen(false);
  }, []);

  const patchDraft = useCallback(
    <S extends keyof VaultSettingsConfig>(
      section: S,
      patch: Partial<VaultSettingsConfig[S]>,
    ) => {
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
    setDeleteOpen(false);
    setDeleteConfirm("");
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
    if (config) setDraft(config);
    handleClose();
  };

  const handleSaveClick = () => {
    if (!isDirty) return;
    dismissFooterConfirm();
    setSaveConfirmOpen(true);
  };

  const handleConfirmSave = () => {
    if (!draft || !isDirty) return;
    persistDraft(draft);
    setSaveConfirmOpen(false);
  };

  const handleConfirmDelete = () => {
    if (!canConfirmDelete || !vault) return;
    onVaultDelete?.(vault.id);
    handleClose();
  };

  const formConfig = draft ?? config;
  if (!open || !vault || !formConfig) return null;

  const footer = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-h-[1.25rem] text-sm" aria-live="polite">
        {discardConfirmOpen ? (
          <p className="text-on-surface-variant">{t("modal.settings.discard_confirm")}</p>
        ) : saveConfirmOpen ? (
          <p className="text-on-surface-variant">{t("modal.settings.save_confirm")}</p>
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
      title={t("modal.settings.title", { name: vault.displayName })}
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
        {VAULT_SETTINGS_SECTIONS.map((sectionId) => (
          <VaultSettingsSection
            key={sectionId}
            title={t(`modal.settings.section.${sectionId}`)}
            defaultOpen={sectionId === "vault"}
          >
            {renderSettingsSection(sectionId, formConfig, patchDraft)}
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
            onConfirmDelete={handleConfirmDelete}
            onConfirmChange={setDeleteConfirm}
          />
        </VaultSettingsSection>
      </div>
    </Modal>
  );
}

function renderSettingsSection(
  sectionId: VaultSettingsSectionId,
  draft: VaultSettingsConfig,
  patchDraft: <S extends keyof VaultSettingsConfig>(
    section: S,
    patch: Partial<VaultSettingsConfig[S]>,
  ) => void,
) {
  switch (sectionId) {
    case "vault":
      return (
        <VaultSettingsVaultSection
          config={draft.vault}
          onChange={(patch) => patchDraft("vault", patch)}
        />
      );
    case "storage":
      return (
        <VaultSettingsStorageSection
          config={draft.storage}
          onChange={(patch) => {
            patchDraft("storage", patch);
            if (patch.mode === "encrypted_dir") {
              const nextSecurity = normalizeSecurityModeForStorage("encrypted_dir", draft.security.mode);
              if (nextSecurity !== draft.security.mode) {
                patchDraft("security", { mode: nextSecurity });
              }
            }
          }}
        />
      );
    case "close":
      return (
        <VaultSettingsCloseSection
          close={draft.close}
          autoClose={draft.auto_close}
          secureWipe={draft.security.secure_wipe_workspace}
          requireUnmountOnSleep={draft.policy.require_unmount_on_sleep}
          onCloseChange={(patch) => patchDraft("close", patch)}
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
    case "seven_zip":
      return (
        <VaultSettingsSevenZipSection
          config={draft.seven_zip}
          onChange={(patch) => patchDraft("seven_zip", patch)}
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
