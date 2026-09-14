import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
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
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { Modal, Select, type SelectOption } from "@/components/ui";
import { VaultRootLocationSection } from "./VaultRootLocationSection";
import { VaultRootConfirmFooter } from "./VaultRootConfirmFooter";

interface VaultRootSetupScreenProps {
  open: boolean;
  presentation?: VaultRootPresentationState;
  distribution: AppDistribution;
  onConfigured: () => void;
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
}: VaultRootSetupScreenProps) {
  const { t } = useTranslation();
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

  useEffect(() => {
    if (!open) {
      openedSessionRef.current = false;
      return;
    }
    if (openedSessionRef.current) return;
    openedSessionRef.current = true;
    setMode("default_root");
    setPath("");
    setGate(VAULT_ROOT_GATE_IDLE);
    setBusy(false);
    setError(null);
    setConfirmOpen(false);
    setInspectNonce(0);
    submitLock.current = false;
    busyGen.current += 1;
    diskApplied.current = null;
  }, [open]);

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
      const { rootPath } = await vaultRoot.setupAtPath(nextPath, {
        replaceIncomplete: current.replacePolicy != null,
        replacePolicy: current.replacePolicy,
        bootstrap: { locale: settings.ui.locale },
      });
      if (gen !== busyGen.current) return;
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
