import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type { VaultRootMode } from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { VaultRootLocationSection } from "./VaultRootLocationSection";
import { VaultRootConfirmFooter } from "./VaultRootConfirmFooter";
import {
  isVaultRootDraftDirty,
  VAULT_ROOT_GATE_IDLE,
  type VaultRootSettingsGate,
} from "./vaultRootSettingsIntent";
import { desktopErrorI18nKey } from "@/lib/errorMessages";

const APPLIED_INDICATOR_MS = 900;

interface VaultRootDataFolderModalProps {
  open: boolean;
  onClose: () => void;
  /** Report unsaved draft so the list shell can refuse opening System Settings. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Dedicated surface for switching/creating the vault-root data folder (⋯ menu).
 * Not part of System Settings Save — avoids mixing appearance drafts with folder switch.
 */
export function VaultRootDataFolderModal({
  open,
  onClose,
  onDirtyChange,
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
  const submitLock = useRef(false);
  const busyGen = useRef(0);
  const openedRef = useRef(false);
  const appliedHideRef = useRef<ReturnType<typeof setTimeout>>();
  const gateRef = useRef(gate);
  gateRef.current = gate;

  const draftDirty = useMemo(
    () =>
      isVaultRootDraftDirty(mode, path, settings.app.vault_root_mode, settings.app.upriv_root_path),
    [mode, path, settings.app.upriv_root_path, settings.app.vault_root_mode],
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
      return;
    }
    // Context reloaded vault-root while open: adopt if user has no local draft.
    if (!draftDirty) {
      setMode(settings.app.vault_root_mode);
      setPath(settings.app.upriv_root_path);
    }
  }, [open, draftDirty, settings.app.upriv_root_path, settings.app.vault_root_mode]);

  useEffect(() => {
    setConfirmOpen(false);
    setDiscardConfirmOpen(false);
  }, [mode, path, gate.replacePolicy, gate.disk]);

  const onVaultRootGateChange = useCallback((next: VaultRootSettingsGate) => {
    setGate(next);
  }, []);

  const onDraftChange = useCallback(
    (patch: { vault_root_mode?: VaultRootMode; upriv_root_path?: string }) => {
      if (patch.vault_root_mode != null) setMode(patch.vault_root_mode);
      if (patch.upriv_root_path != null) setPath(patch.upriv_root_path);
      setError(null);
    },
    [],
  );

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
    if (busy || appliedVisible || !draftDirty || current.blocksPrimary || confirmOpen) return;
    setDiscardConfirmOpen(false);
    setConfirmOpen(true);
  }, [appliedVisible, confirmOpen, busy, draftDirty]);

  const commitApply = useCallback(() => {
    const current = gateRef.current;
    if (submitLock.current || busy || appliedVisible || !draftDirty || current.blocksPrimary) {
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
    vaultRoot,
  ]);

  if (!open) return null;

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
  ) : (
    <VaultRootConfirmFooter
      busy={busy || appliedVisible}
      blocked={!draftDirty || gate.blocksPrimary}
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
        <VaultRootLocationSection
          config={{ vault_root_mode: mode, upriv_root_path: path }}
          onChange={onDraftChange}
          savedVaultRootMode={settings.app.vault_root_mode}
          savedRootPath={settings.app.upriv_root_path}
          onVaultRootGateChange={onVaultRootGateChange}
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
