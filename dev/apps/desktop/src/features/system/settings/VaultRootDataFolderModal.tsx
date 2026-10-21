import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  dataFolderExportPending,
  isVaultRootDraftDirty,
  VAULT_ROOT_GATE_IDLE,
  type VaultRootMode,
  type VaultRootSettingsGate,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import {
  DataFolderExportFooter,
  DataFolderExportPanel,
  useDataFolderExportDestination,
  type DataFolderExportControls,
} from "@/features/system/data-folder-export";
import { useAppSettingsContext } from "./AppSettingsContext";
import { VaultRootLocationSection } from "./VaultRootLocationSection";
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
   * Modal stays openable; controls + Apply stay locked (closed + recovery OK).
   */
  vaultActivityBlocksChange?: boolean;
  /** Export data folder. Absent when this build has no data folder service. */
  exportControls?: DataFolderExportControls;
}

/**
 * Dedicated surface for switching/creating the vault-root data folder (⋯ menu).
 * Not part of System Settings Save — avoids mixing appearance drafts with folder switch.
 * Export a copy is a third radio beside the two folders, and the one footer
 * button follows the choice (Apply / Export / Stop export). Choosing it drops a
 * folder draft, so the copy is always of the folder in use; choosing a folder
 * again goes back.
 */
export function VaultRootDataFolderModal({
  open,
  onClose,
  onDirtyChange,
  vaultActivityBlocksChange = false,
  exportControls,
}: VaultRootDataFolderModalProps) {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const { settings, patchSettings } = useAppSettingsContext();
  const [mode, setMode] = useState<VaultRootMode>(settings.app.vault_root_mode);
  const [path, setPath] = useState(settings.app.upriv_root_path);
  const [gate, setGate] = useState<VaultRootSettingsGate>(VAULT_ROOT_GATE_IDLE);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [appliedVisible, setAppliedVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Export a copy is the chosen radio. A running export keeps it chosen. */
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
  const submitLock = useRef(false);
  const busyGen = useRef(0);
  const openedRef = useRef(false);
  const appliedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const gateRef = useRef(gate);
  gateRef.current = gate;

  const draftDirty = useMemo(
    () =>
      !vaultActivityBlocksChange &&
      isVaultRootDraftDirty(mode, path, settings.app.vault_root_mode, settings.app.upriv_root_path),
    [
      mode,
      path,
      settings.app.upriv_root_path,
      settings.app.vault_root_mode,
      vaultActivityBlocksChange,
    ],
  );

  useEffect(() => {
    onDirtyChange?.(open && draftDirty);
    return () => onDirtyChange?.(false);
  }, [draftDirty, onDirtyChange, open]);

  useEffect(() => {
    return () => clearTimeout(appliedHideRef.current);
  }, []);

  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      setConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setBusy(false);
      setAppliedVisible(false);
      setError(null);
      setExportChosen(false);
      cancelExportPick();
      // The saved line belongs to this opening of the window; the folder stays.
      clearExportWritten?.();
      submitLock.current = false;
      busyGen.current += 1;
      clearTimeout(appliedHideRef.current);
      return;
    }
    if (!openedRef.current) {
      openedRef.current = true;
      setMode(settings.app.vault_root_mode);
      setPath(settings.app.upriv_root_path);
      setGate(VAULT_ROOT_GATE_IDLE);
      setConfirmOpen(false);
      setDiscardConfirmOpen(false);
      setAppliedVisible(false);
      setError(null);
      resetExportZipName();
      // An export that finished while the window was closed already had its toast.
      clearExportWritten?.();
      return;
    }
    // Context reloaded vault-root while open: adopt if user has no local draft.
    if (!draftDirty) {
      setMode(settings.app.vault_root_mode);
      setPath(settings.app.upriv_root_path);
    }
  }, [
    cancelExportPick,
    clearExportWritten,
    open,
    draftDirty,
    resetExportZipName,
    settings.app.upriv_root_path,
    settings.app.vault_root_mode,
  ]);

  // A fresh name after each export. A failed one keeps what was typed.
  useEffect(() => {
    if (exportWritten) resetExportZipName();
  }, [exportWritten, resetExportZipName]);

  useEffect(() => {
    setConfirmOpen(false);
    setDiscardConfirmOpen(false);
  }, [mode, path, gate.replacePolicy, gate.disk]);

  useEffect(() => {
    if (!vaultActivityBlocksChange) return;
    setConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setMode(settings.app.vault_root_mode);
    setPath(settings.app.upriv_root_path);
    setError(null);
  }, [settings.app.upriv_root_path, settings.app.vault_root_mode, vaultActivityBlocksChange]);

  const onVaultRootGateChange = useCallback((next: VaultRootSettingsGate) => {
    setGate(next);
  }, []);

  const onDraftChange = useCallback(
    (patch: { vault_root_mode?: VaultRootMode; upriv_root_path?: string }) => {
      if (vaultActivityBlocksChange) return;
      setExportChosen(false);
      if (patch.vault_root_mode != null) setMode(patch.vault_root_mode);
      if (patch.upriv_root_path != null) setPath(patch.upriv_root_path);
      setError(null);
    },
    [vaultActivityBlocksChange],
  );

  // The copy is of the folder in use, so a folder draft is dropped. Choosing
  // the option opens nothing; its folder field and Choose folder do.
  const selectExport = useCallback(() => {
    setExportChosen(true);
    setMode(settings.app.vault_root_mode);
    setPath(settings.app.upriv_root_path);
    setConfirmOpen(false);
    setDiscardConfirmOpen(false);
    setError(null);
  }, [settings.app.upriv_root_path, settings.app.vault_root_mode]);

  const dismissFooterConfirm = useCallback(() => {
    setConfirmOpen(false);
    setDiscardConfirmOpen(false);
  }, []);

  const requestClose = useCallback(() => {
    if (busy || appliedVisible) return;
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
    setMode(settings.app.vault_root_mode);
    setPath(settings.app.upriv_root_path);
    setDiscardConfirmOpen(false);
    setConfirmOpen(false);
    onClose();
  }, [onClose, settings.app.upriv_root_path, settings.app.vault_root_mode]);

  const requestApply = useCallback(() => {
    const current = gateRef.current;
    if (
      vaultActivityBlocksChange ||
      busy ||
      appliedVisible ||
      !draftDirty ||
      current.blocksPrimary ||
      confirmOpen
    ) {
      return;
    }
    setDiscardConfirmOpen(false);
    setConfirmOpen(true);
  }, [appliedVisible, confirmOpen, busy, draftDirty, vaultActivityBlocksChange]);

  const commitApply = useCallback(() => {
    const current = gateRef.current;
    if (
      vaultActivityBlocksChange ||
      submitLock.current ||
      busy ||
      appliedVisible ||
      !draftDirty ||
      current.blocksPrimary
    ) {
      return;
    }
    // Same source as `blocksPrimary` — refuse incomplete without an explicit policy.
    if (current.disk === "incomplete" && current.replacePolicy == null) {
      setConfirmOpen(false);
      setError(t("modal.vault_root_setup.error_init"));
      return;
    }
    const gen = ++busyGen.current;
    submitLock.current = true;
    setBusy(true);
    setError(null);

    void (async () => {
      const replacePolicy = current.replacePolicy;
      if (mode === "default_root") {
        await vaultRoot.setupDefaultRoot({
          replaceIncomplete: replacePolicy != null,
          replacePolicy,
          bootstrap: { locale: settings.ui.locale },
        });
      } else {
        const nextPath = path.trim();
        if (!nextPath) {
          setConfirmOpen(false);
          setError(t("modal.vault_root_setup.error_path_required"));
          return;
        }
        await vaultRoot.setupAtPath(nextPath, {
          replaceIncomplete: replacePolicy != null,
          replacePolicy,
          bootstrap: { locale: settings.ui.locale },
        });
      }
      if (gen !== busyGen.current) return;

      const saved = await patchSettings(
        {
          app: {
            vault_root_mode: mode,
            upriv_root_path: mode === "custom_root" ? path.trim() : "",
          },
        },
        { vaultRootAlreadyApplied: true },
      );
      if (gen !== busyGen.current) return;
      if (!saved) {
        throw new Error("settings_save_failed");
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
      .catch((err) => {
        if (gen !== busyGen.current) return;
        setError(t(desktopErrorI18nKey(err, "modal.vault_root_setup.error_init")));
      })
      .finally(() => {
        if (gen !== busyGen.current) return;
        submitLock.current = false;
        setBusy(false);
      });
  }, [
    appliedVisible,
    busy,
    draftDirty,
    mode,
    onClose,
    patchSettings,
    path,
    settings.ui.locale,
    t,
    vaultActivityBlocksChange,
    vaultRoot,
  ]);

  // A running export explains its own hold, so the activity notice waits until it ends.
  const showActivityNotice =
    exportControls?.job == null &&
    (vaultActivityBlocksChange || exportControls?.canStart === false);

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
      blocked={vaultActivityBlocksChange || !draftDirty || gate.blocksPrimary}
      confirmOpen={confirmOpen}
      primaryAction="apply"
      confirmDanger={gate.replacePolicy === "delete"}
      noteKeys={gate.confirmNotes}
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
        <VaultRootLocationSection
          config={{ vault_root_mode: mode, upriv_root_path: path, last_opened_vault: "" }}
          onChange={onDraftChange}
          savedVaultRootMode={settings.app.vault_root_mode}
          savedRootPath={settings.app.upriv_root_path}
          onVaultRootGateChange={onVaultRootGateChange}
          controlsDisabled={vaultActivityBlocksChange || busy || appliedVisible}
          extraOption={
            exportControls
              ? {
                  heading: t("modal.data_folder.copy_heading"),
                  hint: t("modal.data_folder.copy_hint"),
                  value: "export",
                  checked: exportSelected,
                  attention: exportNeedsStep,
                  title: t("modal.data_folder_export.title"),
                  description: t("modal.data_folder_export.body"),
                  disabled:
                    busy ||
                    appliedVisible ||
                    (exportControls.job == null && !exportControls.canStart),
                  onSelect: selectExport,
                  // Shown always, and inactive until the option is chosen.
                  footer: (
                    <DataFolderExportPanel
                      controls={exportControls}
                      destination={exportDestination}
                    />
                  ),
                }
              : undefined
          }
        />
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
