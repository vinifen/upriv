import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { PolicyRadioOption } from "@/components/settings";
import { useTranslation } from "@/i18n";
import { VAULT_ROOT_ERROR_CODES, dataFolderExportPending, isRpcError } from "@upriv/shared";
import { hereDevice, useDataFolderList, useDeviceInfo } from "@upriv/shared/react";
import { useDeviceService, useVaultRootService } from "@/platform/services";
import {
  DataFolderExportFooter,
  DataFolderExportPanel,
  useDataFolderExportDestination,
  type DataFolderExportControls,
} from "@/features/system/data-folder-export";
import { useAppSettingsContext } from "./AppSettingsContext";
import { DataFolderListSection } from "./DataFolderListSection";
import { VaultRootConfirmFooter } from "./VaultRootConfirmFooter";
import { desktopErrorI18nKey } from "@/lib/errorMessages";

const APPLIED_INDICATOR_MS = 900;

interface VaultRootDataFolderModalProps {
  open: boolean;
  onClose: () => void;
  /** Report unsaved draft so the list shell can refuse opening System Settings. */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * True while any list vault is open / opening / closing / creating.
   * Modal stays openable; the list and Apply stay locked (closed + recovery OK).
   */
  vaultActivityBlocksChange?: boolean;
  /** Export data folder. Absent when this build has no data folder service. */
  exportControls?: DataFolderExportControls;
  /** List toast. An Apply keeps running after the window closes and reports here. */
  onNotice?: (message: string) => void;
}

/**
 * The data folder list (⋯ menu → Data folder): this device's folders with
 * the one in use, Apply opening the folder it selects in one
 * `data_folder_apply`. Not part of System settings Save.
 * Export a copy is a further option below the list, and the one footer
 * button follows the choice (Apply / Export / Stop export). Choosing it drops
 * the list's draft, so the copy is always of the folder in use; choosing a
 * folder again goes back.
 */
export function VaultRootDataFolderModal({
  open,
  onClose,
  onDirtyChange,
  vaultActivityBlocksChange = false,
  exportControls,
  onNotice,
}: VaultRootDataFolderModalProps) {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const here = hereDevice(useDeviceInfo(useDeviceService()));
  const { settings, adoptDataFolder } = useAppSettingsContext();
  const exportGroup = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [appliedVisible, setAppliedVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Export a copy is the chosen option. A running export keeps it chosen. */
  const [exportChosen, setExportChosen] = useState(false);
  const exportDestination = useDataFolderExportDestination();
  const { resetZipName: resetExportZipName } = exportDestination;
  const { cancelPick: cancelExportPick } = exportDestination.folder;
  const exportSelected = exportControls != null && (exportChosen || exportControls.job != null);
  const exportWritten = exportControls?.written ?? null;
  const clearExportWritten = exportControls?.clearWritten;
  // Chosen and still missing its folder or a usable name: the step left before Export.
  const exportNeedsStep =
    exportSelected &&
    exportControls?.job == null &&
    dataFolderExportPending(exportDestination.folder.path, exportDestination.zipName) !== null;
  const list = useDataFolderList({
    service: vaultRoot,
    here,
    active: open,
    opening: false,
    primaryAction: "apply",
  });
  const { reset: resetList } = list;
  const submitLock = useRef(false);
  /** Bumped only when Apply runs past `OPERATION_LIMIT_MS`; closing never drops a result. */
  const busyGen = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;
  const appliedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const draftDirty = !vaultActivityBlocksChange && list.dirty;

  useEffect(() => {
    onDirtyChange?.(open && draftDirty);
    return () => onDirtyChange?.(false);
  }, [draftDirty, onDirtyChange, open]);

  useEffect(() => {
    return () => clearTimeout(appliedHideRef.current);
  }, []);

  useEffect(() => {
    setConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setAppliedVisible(false);
    setError(null);
    setExportChosen(false);
    clearTimeout(appliedHideRef.current);
    // The saved line belongs to one opening of the window; the folder stays.
    clearExportWritten?.();
    if (open) {
      resetExportZipName();
      return;
    }
    // An Apply in flight keeps running; its outcome comes back as a list toast.
    cancelExportPick();
  }, [cancelExportPick, clearExportWritten, open, resetExportZipName]);

  // A fresh name after each export. A failed one keeps what was typed.
  useEffect(() => {
    if (exportWritten) resetExportZipName();
  }, [exportWritten, resetExportZipName]);

  // Vault work started: the list goes back to how it is saved.
  useEffect(() => {
    if (!vaultActivityBlocksChange) return;
    setConfirmOpen(false);
    setDiscardConfirmOpen(false);
    resetList();
    setError(null);
  }, [resetList, vaultActivityBlocksChange]);

  const dismissFooterConfirm = useCallback(() => {
    setConfirmOpen(false);
    setDiscardConfirmOpen(false);
  }, []);

  const onListEdit = useCallback(() => {
    setExportChosen(false);
    dismissFooterConfirm();
    setError(null);
  }, [dismissFooterConfirm]);

  // The copy is of the folder in use, so the list's draft is dropped. Choosing
  // the option opens nothing; its folder field and Choose folder do.
  const selectExport = useCallback(() => {
    setExportChosen(true);
    resetList();
    dismissFooterConfirm();
    setError(null);
  }, [dismissFooterConfirm, resetList]);

  const requestClose = useCallback(() => {
    // The Applied line closes the window itself a moment later.
    if (appliedVisible) return;
    // A folder being applied is not a draft: Apply keeps running and reports with a toast.
    if (busy) {
      onClose();
      return;
    }
    if (confirmOpen || discardConfirmOpen) {
      dismissFooterConfirm();
      return;
    }
    if (draftDirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  }, [
    appliedVisible,
    busy,
    confirmOpen,
    discardConfirmOpen,
    dismissFooterConfirm,
    draftDirty,
    onClose,
  ]);

  const handleDiscardAndClose = useCallback(() => {
    resetList();
    dismissFooterConfirm();
    onClose();
  }, [dismissFooterConfirm, onClose, resetList]);

  const applyBlocked = vaultActivityBlocksChange || !draftDirty || list.blocksPrimary;

  const requestApply = () => {
    if (busy || appliedVisible || applyBlocked || confirmOpen) return;
    setDiscardConfirmOpen(false);
    setConfirmOpen(true);
  };

  const commitApply = () => {
    if (submitLock.current || busy || appliedVisible || applyBlocked) return;
    const gen = ++busyGen.current;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      const applied = await vaultRoot.apply({
        changes: list.changes,
        replacePolicy: list.replacePolicy ?? undefined,
        bootstrap: { locale: settings.ui.locale },
      });
      if (gen !== busyGen.current) return;
      if (applied.switched) await adoptDataFolder();
      if (!openRef.current) {
        onNotice?.(t("modal.data_folder.applied"));
        return;
      }
      setConfirmOpen(false);
      setAppliedVisible(true);
      clearTimeout(appliedHideRef.current);
      appliedHideRef.current = setTimeout(() => {
        if (gen !== busyGen.current) return;
        setAppliedVisible(false);
        onClose();
      }, APPLIED_INDICATOR_MS);
    })()
      .catch((caught: unknown) => {
        if (gen !== busyGen.current) return;
        // The folder may have changed since its check: check again.
        list.retryStatuses();
        if (isRpcError(caught) && caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) {
          if (openRef.current) setConfirmOpen(false);
          return;
        }
        const message = t(desktopErrorI18nKey(caught, "modal.vault_root_setup.error_init"));
        if (openRef.current) {
          setConfirmOpen(false);
          setError(message);
        } else {
          onNotice?.(message);
        }
      })
      .finally(() => {
        if (gen !== busyGen.current) return;
        submitLock.current = false;
        setBusy(false);
      });
  };

  // A running export explains its own hold, so the activity notice waits until it ends.
  const showActivityNotice =
    exportControls?.job == null &&
    (vaultActivityBlocksChange || exportControls?.canStart === false);
  const listLocked =
    vaultActivityBlocksChange || busy || appliedVisible || exportControls?.job != null;

  const footer = discardConfirmOpen ? (
    <div className="flex flex-col gap-3">
      <div className="text-sm" aria-live="polite">
        <p className="text-on-surface-variant">{t("modal.settings.discard_confirm")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:flex-wrap sm:justify-start [&_button]:w-full sm:[&_button]:w-auto">
        <Button variant="danger" size="md" onClick={handleDiscardAndClose}>
          {t("modal.settings.discard_confirm_action")}
        </Button>
        <Button variant="ghost" size="md" onClick={dismissFooterConfirm}>
          {t("modal.settings.discard_keep_editing")}
        </Button>
      </div>
    </div>
  ) : exportControls && exportSelected ? (
    <DataFolderExportFooter controls={exportControls} destination={exportDestination} />
  ) : (
    <VaultRootConfirmFooter
      busy={busy || appliedVisible}
      blocked={applyBlocked}
      confirmOpen={confirmOpen}
      primaryAction="apply"
      confirmDanger={list.replacePolicy === "delete"}
      noteKeys={list.gate.confirmNotes}
      successKey={appliedVisible ? "modal.data_folder.applied" : undefined}
      onRequestPrimary={requestApply}
      onConfirmPrimary={commitApply}
      onCancelConfirm={() => setConfirmOpen(false)}
      onBusyTimeout={() => {
        busyGen.current += 1;
        submitLock.current = false;
        setBusy(false);
        setConfirmOpen(false);
        setError(t("loading.timed_out"));
      }}
    />
  );

  return (
    <Modal
      open={open}
      title={t("modal.data_folder.title")}
      titleIcon="folder"
      onClose={requestClose}
      panelClassName="max-w-lg"
      footer={footer}
    >
      <div
        className="space-y-3"
        onPointerDown={() => {
          if (confirmOpen || discardConfirmOpen) dismissFooterConfirm();
        }}
      >
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t("modal.data_folder.body")}
        </p>
        {showActivityNotice ? (
          <p
            className="rounded-md bg-error-container/10 px-3 py-2 text-sm text-on-error-container"
            role="status"
          >
            {t("modal.data_folder.blocked_vault_activity")}
          </p>
        ) : null}
        <DataFolderListSection
          list={list}
          here={here}
          showInUse
          disabled={listLocked}
          noneChecked={exportSelected}
          onEdit={onListEdit}
        />
        {exportControls ? (
          <div className="space-y-2 pt-2">
            <div className="space-y-1.5">
              <h3 className="text-sm font-medium text-on-surface">
                {t("modal.data_folder.copy_heading")}
              </h3>
              <p className="text-xs leading-relaxed text-on-surface-variant">
                {t("modal.data_folder.copy_hint")}
              </p>
            </div>
            <PolicyRadioOption
              groupName={exportGroup}
              value="export"
              checked={exportSelected}
              attention={exportNeedsStep}
              title={t("modal.data_folder_export.title")}
              description={t("modal.data_folder_export.body")}
              disabled={
                busy || appliedVisible || (exportControls.job == null && !exportControls.canStart)
              }
              onSelect={selectExport}
              // Shown always, and inactive until the option is chosen.
              footer={
                <DataFolderExportPanel controls={exportControls} destination={exportDestination} />
              }
            />
          </div>
        ) : null}
        {error ? (
          <p
            className="rounded-md bg-error-container/10 px-3 py-2 text-sm text-on-error-container"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
