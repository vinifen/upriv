import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, Text, View } from "react-native";
import {
  SUPPORTED_LOCALES,
  VAULT_ROOT_ALIAS_FILE,
  VAULT_ROOT_ERROR_CODES,
  VAULT_ROOT_GATE_IDLE,
  isRpcError,
  sameVaultRootPath,
  type AppDistribution,
  type LocaleId,
  type VaultRootMode,
  type VaultRootPresentationState,
  type VaultRootSettingsGate,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { useTranslation, type I18nKey } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useToast } from "@upriv/shared/react";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { Modal, Select, type SelectOption } from "@/components/ui";
import { Toast } from "@/components/ui/Toast";
import { alertIfPrivateRootLeftBehind, pickDocumentsUprivFolder } from "./dataFolderGrant";
import { VaultRootLocationSection } from "./VaultRootLocationSection";
import { VaultRootConfirmFooter } from "./VaultRootConfirmFooter";

interface VaultRootSetupScreenProps {
  open: boolean;
  presentation?: VaultRootPresentationState;
  distribution: AppDistribution;
  onConfigured: () => void;
  /**
   * The saved Custom folder could not be reached (drive unplugged).
   * Custom stays selected. Opening the app again with the drive connected
   * continues when this choice is unchanged.
   */
  reconnectNotice?: boolean;
  onReconnect?: () => Promise<void> | void;
}

/**
 * Blocking first-run screen when no vault-root is found.
 *
 * Full desktop parity: shared `VaultRootLocationSection` (default / custom
 * radios + live inspect + SAF-aware picker), two-step `VaultRootConfirmFooter`,
 * pre-root locale selector, disk-applied cache to avoid duplicate `setup*`
 * calls, and busy-budget timeout that clears state.
 */
export function VaultRootSetupScreen({
  open,
  presentation,
  distribution,
  onConfigured,
  reconnectNotice = false,
  onReconnect,
}: VaultRootSetupScreenProps) {
  const { t } = useTranslation();
  const { toast, show: showToast, dismiss: dismissToast } = useToast();
  const { colors, typography } = useTheme();
  const vaultRoot = useVaultRootService();
  const { settings, patchSettings } = useAppSettingsContext();
  const aliasPath = presentation?.aliasPath ?? "";
  const [mode, setMode] = useState<VaultRootMode>("default_root");
  const [path, setPath] = useState("");
  const [gate, setGate] = useState<VaultRootSettingsGate>(VAULT_ROOT_GATE_IDLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [inspectNonce, setInspectNonce] = useState(0);
  const submitLock = useRef(false);
  const busyGen = useRef(0);
  const diskApplied = useRef<{ rootPath: string; mode: VaultRootMode } | null>(null);
  const gateRef = useRef(gate);
  gateRef.current = gate;

  const openedSessionRef = useRef(false);
  /** Custom folder this screen was opened on. Resume only while the draft still matches. */
  const reconnectBaselineRef = useRef<{ mode: VaultRootMode; path: string } | null>(null);
  const modeRef = useRef(mode);
  const pathRef = useRef(path);
  modeRef.current = mode;
  pathRef.current = path;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useLayoutEffect(() => {
    if (!open) {
      openedSessionRef.current = false;
      reconnectBaselineRef.current = null;
      return;
    }
    if (openedSessionRef.current) return;
    openedSessionRef.current = true;
    const remembered = presentation?.rememberedAliasTarget?.trim() ?? "";
    setMode(reconnectNotice ? "custom_root" : "default_root");
    setPath(reconnectNotice ? remembered : "");
    reconnectBaselineRef.current = reconnectNotice
      ? { mode: "custom_root", path: remembered }
      : null;
    setGate(VAULT_ROOT_GATE_IDLE);
    setBusy(false);
    setError(null);
    setConfirmOpen(false);
    setInspectNonce(0);
    submitLock.current = false;
    busyGen.current += 1;
    diskApplied.current = null;
  }, [open, presentation, reconnectNotice]);

  useEffect(() => {
    setConfirmOpen(false);
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

  const handleLocaleChange = useCallback(
    (locale: LocaleId) => {
      if (locale === settings.ui.locale) return;
      void patchSettings({ ui: { locale } });
    },
    [patchSettings, settings.ui.locale],
  );

  const finish = useCallback(
    async (rootPath: string, nextMode: VaultRootMode, gen: number) => {
      diskApplied.current = { rootPath, mode: nextMode };
      const saved = await patchSettings(
        {
          app: {
            vault_root_mode: nextMode,
            upriv_root_path: nextMode === "custom_root" ? rootPath : "",
          },
        },
        { vaultRootAlreadyApplied: true },
      );
      if (gen !== busyGen.current) return;
      if (!saved) {
        throw new Error("settings_save_failed");
      }
      onConfigured();
    },
    [onConfigured, patchSettings],
  );

  const requestContinue = useCallback(() => {
    const current = gateRef.current;
    if (busy || current.blocksPrimary || confirmOpen) return;
    setConfirmOpen(true);
  }, [busy, confirmOpen]);

  const commitContinue = useCallback(() => {
    const current = gateRef.current;
    if (current.blocksPrimary || busy || submitLock.current) return;

    if (mode === "default_root") {
      const gen = ++busyGen.current;
      submitLock.current = true;
      setBusy(true);
      setError(null);
      void (async () => {
        if (Platform.OS === "android") {
          const suggested = await vaultRoot.suggestedCustomRootPath().catch(() => "");
          const picked = await pickDocumentsUprivFolder(
            (initial, title) => vaultRoot.pickFolder(initial, title),
            suggested || null,
            t("modal.vault_root_setup.pick_folder_title"),
          );
          if (gen !== busyGen.current) return;
          if (picked.status === "cancelled") {
            setConfirmOpen(false);
            return;
          }
          const { rootPath, privateRoot } = await vaultRoot.setupAtPath(picked.uri, {
            replaceIncomplete: current.replacePolicy != null,
            replacePolicy: current.replacePolicy,
            bootstrap: { locale: settings.ui.locale },
          });
          if (gen !== busyGen.current) return;
          alertIfPrivateRootLeftBehind(
            privateRoot,
            t("modal.vault_root_setup.title"),
            t("modal.vault_root_setup.private_root_left_behind"),
          );
          await finish(rootPath, "custom_root", gen);
          return;
        }
        if (diskApplied.current?.mode === "default_root") {
          if (gen !== busyGen.current) return;
          await finish(diskApplied.current.rootPath, "default_root", gen);
          return;
        }
        const { rootPath } = await vaultRoot.setupDefaultRoot({
          replaceIncomplete: current.replacePolicy != null,
          replacePolicy: current.replacePolicy,
          bootstrap: { locale: settings.ui.locale },
        });
        if (gen !== busyGen.current) return;
        await finish(rootPath, "default_root", gen);
      })()
        .catch((caught) => {
          if (gen !== busyGen.current) return;
          if (isRpcError(caught) && caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) {
            setInspectNonce((n) => n + 1);
            setError(null);
            return;
          }
          setError(t(mobileErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
        })
        .finally(() => {
          if (gen !== busyGen.current) return;
          submitLock.current = false;
          setBusy(false);
        });
      return;
    }

    const nextPath = path.trim();
    if (!nextPath) {
      setConfirmOpen(false);
      setError(t("modal.vault_root_setup.error_path_required"));
      return;
    }

    const gen = ++busyGen.current;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      const applied = diskApplied.current;
      if (
        applied?.mode === "custom_root" &&
        current.replacePolicy == null &&
        sameVaultRootPath(applied.rootPath, nextPath)
      ) {
        if (gen !== busyGen.current) return;
        await finish(applied.rootPath, "custom_root", gen);
        return;
      }
      if (applied && !sameVaultRootPath(applied.rootPath, nextPath)) {
        diskApplied.current = null;
      }
      const { rootPath, privateRoot } = await vaultRoot.setupAtPath(nextPath, {
        replaceIncomplete: current.replacePolicy != null,
        replacePolicy: current.replacePolicy,
        bootstrap: { locale: settings.ui.locale },
      });
      if (gen !== busyGen.current) return;
      alertIfPrivateRootLeftBehind(
        privateRoot,
        t("modal.vault_root_setup.title"),
        t("modal.vault_root_setup.private_root_left_behind"),
      );
      await finish(rootPath, "custom_root", gen);
    })()
      .catch((caught) => {
        if (gen !== busyGen.current) return;
        if (
          current.replacePolicy == null &&
          isRpcError(caught) &&
          caught.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE
        ) {
          setInspectNonce((n) => n + 1);
          setError(null);
          return;
        }
        setError(t(mobileErrorI18nKey(caught, "modal.vault_root_setup.error_init")));
      })
      .finally(() => {
        if (gen !== busyGen.current) return;
        submitLock.current = false;
        setBusy(false);
      });
  }, [busy, finish, mode, path, settings.ui.locale, t, vaultRoot]);

  const reconnectBaseline = reconnectBaselineRef.current;
  const reconnectUnchanged =
    reconnectNotice &&
    reconnectBaseline != null &&
    mode === reconnectBaseline.mode &&
    path.trim() === reconnectBaseline.path;

  const reconnectToastShownRef = useRef(false);
  useEffect(() => {
    if (!open) {
      reconnectToastShownRef.current = false;
      return;
    }
    if (!reconnectNotice || reconnectToastShownRef.current) return;
    if (gate.disk !== "unreachable") return;
    reconnectToastShownRef.current = true;
    showToast(t("modal.vault_root_setup.error_unreachable"));
  }, [open, reconnectNotice, gate.disk, showToast, t]);

  useEffect(() => {
    if (!open || !reconnectNotice) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      const baseline = reconnectBaselineRef.current;
      if (!baseline || !baseline.path) return;
      if (modeRef.current !== baseline.mode || pathRef.current.trim() !== baseline.path) return;
      void onReconnectRef.current?.();
    });
    return () => sub.remove();
  }, [open, reconnectNotice]);

  const setupBodyKey: I18nKey =
    distribution === "installed"
      ? "modal.vault_root_setup.body_installed"
      : distribution === "dev"
        ? "modal.vault_root_setup.body_dev"
        : "modal.vault_root_setup.body_portable";

  if (!open) return null;

  const localeOptions: SelectOption<LocaleId>[] = SUPPORTED_LOCALES.map((loc) => ({
    value: loc as LocaleId,
    label: t(`modal.app_settings.option.locale.${loc}`),
  }));

  return (
    <Modal
      open={open}
      title={t("modal.vault_root_setup.title")}
      titleIcon="folder"
      onClose={() => undefined}
      dismissible={false}
      panelClassName="max-w-lg"
      overlay={<Toast toast={toast} onDismiss={dismissToast} />}
      headerActions={
        <View style={styles.localeSelect}>
          <Select<LocaleId>
            value={settings.ui.locale as LocaleId}
            options={localeOptions}
            onChange={handleLocaleChange}
            disabled={busy}
            size="sm"
            accessibilityLabel={t("modal.app_settings.field.locale")}
          />
        </View>
      }
      footer={
        <VaultRootConfirmFooter
          busy={busy}
          blocked={gate.blocksPrimary}
          confirmOpen={confirmOpen}
          noteKeys={gate.confirmNotes}
          confirmDanger={gate.replacePolicy === "delete"}
          onRequestPrimary={requestContinue}
          onConfirmPrimary={commitContinue}
          onCancelConfirm={() => setConfirmOpen(false)}
          onBusyTimeout={() => {
            busyGen.current += 1;
            submitLock.current = false;
            setBusy(false);
            setConfirmOpen(false);
            setError(t("loading.timed_out"));
          }}
        />
      }
    >
      <View style={styles.body}>
        <Text style={typography.bodyMuted}>{t(setupBodyKey)}</Text>

        {reconnectUnchanged && gate.disk === "unreachable" ? (
          <Text
            style={[typography.body, { color: colors.onErrorContainer }]}
            accessibilityRole="alert"
          >
            {t("modal.vault_root_setup.error_unreachable")}
          </Text>
        ) : null}

        <VaultRootLocationSection
          config={{ vault_root_mode: mode, upriv_root_path: path, last_opened_vault: "" }}
          onChange={onDraftChange}
          savedVaultRootMode="default_root"
          savedRootPath=""
          forceDirty
          primaryAction="continue"
          controlsDisabled={busy}
          inspectNonce={inspectNonce}
          onVaultRootGateChange={onVaultRootGateChange}
          customRootNotice={
            aliasPath ? (
              <Text style={typography.caption}>
                {t("modal.vault_root_setup.alias_notice", {
                  file: VAULT_ROOT_ALIAS_FILE,
                  aliasPath,
                })}
              </Text>
            ) : undefined
          }
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
  localeSelect: { flexShrink: 0, maxWidth: 256 },
});
