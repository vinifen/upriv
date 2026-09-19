import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { AppSettingsGroupsSection } from "@/features/system/settings/appSettingsForm";
import { useAppSettingsContext } from "@/features/system/settings";
import { useErrorToast } from "@/hooks/useErrorToast";
import { useTranslation } from "@/i18n";
import {
  APP_SETTINGS_ERROR_I18N_KEYS,
  isRpcError,
  shouldBumpVaultRootEpoch,
  validateDisplayName,
  normalizeStoredName,
  type VaultGroup,
  type VaultListItem,
} from "@upriv/shared";

const SAVED_INDICATOR_MS = 1500;

interface VaultGroupsModalProps {
  open: boolean;
  onClose: () => void;
  vaults: VaultListItem[];
  groups: VaultGroup[];
  includeHidden?: boolean;
  onCreateGroup?: (
    displayName: string,
    groupedVaultIds: string[],
    hidden: boolean,
  ) => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}

/** Create groups — opened from the list header ⋯ menu. */
export function VaultGroupsModal({
  open,
  onClose,
  vaults,
  groups,
  includeHidden = false,
  onCreateGroup,
  onDirtyChange,
}: VaultGroupsModalProps) {
  const { t } = useTranslation();
  const { showError } = useErrorToast();
  const { settingsOnDisk, reportVaultRootIntegrityFailure } = useAppSettingsContext();

  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupedVaultIds, setGroupedVaultIds] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);
  const savedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const openedSessionRef = useRef(false);
  const commitSaveLock = useRef(false);

  const pendingGroupName = normalizeStoredName(newGroupName);
  const isDirty = pendingGroupName.length > 0;

  useEffect(() => {
    onDirtyChange?.(open && isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange, open]);

  useEffect(() => {
    if (!open) return;
    if (openedSessionRef.current) return;
    openedSessionRef.current = true;
    setNewGroupName("");
    setGroupedVaultIds([]);
    setHidden(false);
  }, [open]);

  useEffect(() => {
    if (!open) {
      openedSessionRef.current = false;
      setNewGroupName("");
      setGroupedVaultIds([]);
      setHidden(false);
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

  const handleClose = () => {
    setSaveConfirmOpen(false);
    setDiscardConfirmOpen(false);
    onClose();
  };

  const hadOnDiskRef = useRef(false);
  useEffect(() => {
    if (settingsOnDisk) hadOnDiskRef.current = true;
  }, [settingsOnDisk]);

  useEffect(() => {
    if (!open || settingsOnDisk || !hadOnDiskRef.current) return;
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
    setNewGroupName("");
    setGroupedVaultIds([]);
    setHidden(false);
    handleClose();
  };

  const handleSaveClick = () => {
    if (!isDirty || saveBusy) return;
    const validation = validateDisplayName(pendingGroupName);
    if (validation) return;
    dismissFooterConfirm();
    setSaveConfirmOpen(true);
  };

  const commitSave = () => {
    if (!isDirty || saveBusy) return;
    if (commitSaveLock.current) return;
    commitSaveLock.current = true;
    setSaveBusy(true);
    void (async () => {
      try {
        await onCreateGroup?.(pendingGroupName, groupedVaultIds, hidden);
        setNewGroupName("");
        setGroupedVaultIds([]);
        setHidden(false);
        setSavedVisible(true);
        clearTimeout(savedHideRef.current);
        savedHideRef.current = setTimeout(() => setSavedVisible(false), SAVED_INDICATOR_MS);
        setSaveConfirmOpen(false);
      } catch (error) {
        setSaveConfirmOpen(false);
        if (shouldBumpVaultRootEpoch(error)) {
          void reportVaultRootIntegrityFailure(error).then(() => {
            handleClose();
          });
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

  const saveBlocked = !isDirty || saveBusy || saveConfirmOpen;

  const footer = (
    <div className="flex flex-col gap-3">
      <div className="text-sm" aria-live="polite">
        {discardConfirmOpen ? (
          <p className="text-on-surface-variant">{t("modal.settings.discard_confirm")}</p>
        ) : saveConfirmOpen ? (
          <p className="text-on-surface-variant">{t("modal.groups.save_confirm")}</p>
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
      title={t("app.menu.groups")}
      titleIcon="layers"
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
        <AppSettingsGroupsSection
          vaults={vaults}
          groups={groups}
          includeHidden={includeHidden}
          newGroupName={newGroupName}
          groupedVaultIds={groupedVaultIds}
          hidden={hidden}
          onHiddenChange={(next) => {
            setHidden(next);
            setSaveConfirmOpen(false);
            setDiscardConfirmOpen(false);
          }}
          onNewGroupNameChange={(name) => {
            setNewGroupName(name);
            setSaveConfirmOpen(false);
            setDiscardConfirmOpen(false);
          }}
          onToggleGroupedVault={(vaultId) => {
            setGroupedVaultIds((current) =>
              current.includes(vaultId)
                ? current.filter((id) => id !== vaultId)
                : [...current, vaultId],
            );
            setSaveConfirmOpen(false);
            setDiscardConfirmOpen(false);
          }}
        />
      </div>
    </Modal>
  );
}
