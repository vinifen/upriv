import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  isVaultRootDraftDirty,
  VAULT_ROOT_GATE_IDLE,
  type VaultRootMode,
  type VaultRootSettingsGate,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { Button, Modal } from "@/components/ui";
import { ModalFooterActions, modalFooterConfirmBtnStyle } from "@/components/ui/ModalFooterActions";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { VaultRootLocationSection } from "./VaultRootLocationSection";
import { VaultRootConfirmFooter } from "./VaultRootConfirmFooter";

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
}

/**
 * Dedicated surface for switching/creating the vault-root data folder (⋯ menu).
 * Not part of System Settings Save — avoids mixing appearance drafts with folder
 * switch. Mirrors desktop `VaultRootDataFolderModal` semantics; SAF picker stays
 * behind `VaultRootLocationSection` and `isAndroidSafUri`.
 *
 * Keeps the recent Apply ordering: close the modal BEFORE `patchSettings`
 * reloads settings from the new root, so theme/locale do not flash while the
 * modal is still visible.
 */
export function VaultRootDataFolderModal({
  open,
  onClose,
  onDirtyChange,
  vaultActivityBlocksChange = false,
}: VaultRootDataFolderModalProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
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
  const appliedHideRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      if (patch.vault_root_mode != null) setMode(patch.vault_root_mode);
      if (patch.upriv_root_path != null) setPath(patch.upriv_root_path);
      setError(null);
    },
    [vaultActivityBlocksChange],
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

      // Applied indicator briefly, then close BEFORE patchSettings reload —
      // keeps the modal from flashing the new root's theme while still open.
      setConfirmOpen(false);
      setAppliedVisible(true);
      clearTimeout(appliedHideRef.current);
      appliedHideRef.current = setTimeout(() => {
        if (gen !== busyGen.current) return;
        setAppliedVisible(false);
        onClose();
        void patchSettings(
          {
            app: {
              vault_root_mode: mode,
              upriv_root_path: mode === "custom_root" ? path.trim() : "",
            },
          },
          { vaultRootAlreadyApplied: true },
        );
      }, APPLIED_INDICATOR_MS);
    })()
      .catch((err) => {
        if (gen !== busyGen.current) return;
        setError(t(mobileErrorI18nKey(err, "modal.vault_root_setup.error_init")));
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

  const footer = discardConfirmOpen ? (
    <View style={styles.footerCol}>
      <Text style={typography.bodyMuted}>{t("modal.settings.discard_confirm")}</Text>
      <ModalFooterActions layout="confirm">
        <Button
          variant="danger"
          label={t("modal.settings.discard_confirm_action")}
          style={modalFooterConfirmBtnStyle}
          onPress={handleDiscardAndClose}
        />
        <Button
          variant="ghost"
          label={t("modal.settings.discard_keep_editing")}
          style={modalFooterConfirmBtnStyle}
          onPress={dismissFooterConfirm}
        />
      </ModalFooterActions>
    </View>
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
      <View style={styles.body}>
        <Text style={typography.bodyMuted}>{t("modal.data_folder.body")}</Text>
        {vaultActivityBlocksChange ? (
          <Text
            style={[typography.body, { color: colors.onErrorContainer }]}
            accessibilityRole="text"
          >
            {t("modal.data_folder.blocked_vault_activity")}
          </Text>
        ) : null}
        <VaultRootLocationSection
          config={{ vault_root_mode: mode, upriv_root_path: path, last_opened_vault: "" }}
          onChange={onDraftChange}
          savedVaultRootMode={settings.app.vault_root_mode}
          savedRootPath={settings.app.upriv_root_path}
          onVaultRootGateChange={onVaultRootGateChange}
          controlsDisabled={vaultActivityBlocksChange || busy || appliedVisible}
        />
        {error ? (
          <Text
            style={[typography.body, { color: colors.onErrorContainer }]}
            accessibilityRole="alert"
          >
            {error}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  footerCol: { gap: spacing.md },
});
