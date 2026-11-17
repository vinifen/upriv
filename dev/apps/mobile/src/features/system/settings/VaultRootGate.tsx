import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  VAULT_ROOT_ERROR_CODES,
  dataFolderChangeMessage,
  isRpcError,
  type FolderSwitch,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useOperationLimit, useToast } from "@upriv/shared/react";
import { Button, FloatingToast, Modal, ModalFooterActions } from "@/components/ui";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { VaultRootSetupScreen, type SetupScreen } from "./VaultRootSetupScreen";
import { AppBootCover } from "./AppBootCover";

interface VaultRootGateProps {
  children: ReactNode;
}

/**
 * Resolves the data folder on launch and blocks with the data folder list
 * until one is in use (RN parity for desktop `VaultRootGate`): the first
 * run, a selected choice that did not answer (with the search for one that
 * does), a broken `.upriv/` (Repair), or a list file that cannot be read. A
 * data folder lost while Upriv runs (a drive away, a grant gone) stays
 * selected, so the resolve after it lands on the same screens.
 *
 * - `found` (with env override notice when `source === "explicit"`)
 * - Loading / applying limits with retry
 * - Launch cover (`AppBootCover`) until settings and the first resolve settle
 * - Epoch soft-block while re-resolve runs after a mutation
 *
 * Children stay mounted under `pointerEvents="none"` while blocked.
 */
export function VaultRootGate({ children }: VaultRootGateProps) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const { colors, typography } = useTheme();
  const vaultRoot = useVaultRootService();
  const { settingsReady, settingsLoadFailed, vaultRootEpoch, reloadSettings } =
    useAppSettingsContext();
  const { toast, show: showToast, dismiss: dismissToast } = useToast();
  const [ready, setReady] = useState(false);
  /** Starts true so the launch resolve runs under `OPERATION_LIMIT_MS`. */
  const [applying, setApplying] = useState(true);
  /** Latched once the launch settles; `AppBootCover` covers everything until then. */
  const [booted, setBooted] = useState(false);
  const [screen, setScreen] = useState<SetupScreen | null>(null);
  /** The vaults that ended with a lost data folder, as the blocking resolve named them. */
  const [ended, setEnded] = useState<readonly string[]>([]);
  const [resolveError, setResolveError] = useState<string | null>(null);
  /** Non-blocking notice when env/CLI sets an explicit vault-root override. */
  const [envOverridePath, setEnvOverridePath] = useState<string | null>(null);
  const [settingsLoadTimedOut, setSettingsLoadTimedOut] = useState(false);
  const resolveGen = useRef(0);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const prevEpochRef = useRef(vaultRootEpoch);

  const block = useCallback(
    (next: SetupScreen | null, error: string | null, lost: readonly string[] = []) => {
      setScreen(next);
      setEnded(lost);
      setResolveError(error);
      setApplying(false);
      setReady(false);
    },
    [],
  );

  const runResolve = useCallback((): Promise<void> => {
    if (!settingsReady) return Promise.resolve();
    const gen = ++resolveGen.current;
    return (async () => {
      try {
        const result = await vaultRoot.resolve();
        if (gen !== resolveGen.current) return;
        switch (result.status) {
          case "found":
            setScreen(null);
            setResolveError(null);
            setApplying(false);
            setReady(true);
            setEnvOverridePath(result.source === "explicit" ? result.rootPath : null);
            return;
          case "needs_setup":
            block({ kind: "first_run" }, null, result.ended);
            return;
          case "selected_failed":
            block(
              { kind: "selected_failed", choice: result.choice, reason: result.reason },
              null,
              result.ended,
            );
            return;
        }
      } catch (error) {
        if (gen !== resolveGen.current) return;
        if (isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE) {
          block({ kind: "repair" }, null);
        } else if (isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.LIST_INVALID) {
          block({ kind: "list_invalid" }, null);
        } else {
          block(null, tRef.current(mobileErrorI18nKey(error, "error.service_unavailable")));
        }
      }
    })();
  }, [block, settingsReady, vaultRoot]);

  const runResolveRef = useRef(runResolve);
  runResolveRef.current = runResolve;

  useEffect(() => {
    if (vaultRootEpoch !== prevEpochRef.current) {
      prevEpochRef.current = vaultRootEpoch;
      // Soft-block children on the previous root while re-resolve runs after a mutation.
      if (readyRef.current) {
        setApplying(true);
        setReady(false);
      }
    }
    if (!settingsReady) return;
    void runResolveRef.current();
  }, [settingsReady, vaultRootEpoch]);

  const configured = useCallback(
    (change: FolderSwitch | null, ended: readonly string[]) => {
      setScreen(null);
      setResolveError(null);
      setApplying(true);
      setReady(false);
      const message = dataFolderChangeMessage(change, ended, tRef.current);
      if (message) showToast(message);
      void runResolveRef.current();
    },
    [showToast],
  );

  const blocking = !ready || !settingsReady || applying;
  const showLoadingSettings = !settingsReady && screen === null && resolveError === null;
  const showApplying = applying && settingsReady && screen === null && resolveError === null;

  const settingsLimit = useOperationLimit(
    showLoadingSettings && !settingsLoadTimedOut && !settingsLoadFailed,
  );
  const applyingLimit = useOperationLimit(showApplying);

  useEffect(() => {
    if (!settingsLimit.timedOut || !showLoadingSettings) return;
    setSettingsLoadTimedOut(true);
  }, [settingsLimit.timedOut, showLoadingSettings]);

  useEffect(() => {
    if (settingsReady) setSettingsLoadTimedOut(false);
  }, [settingsReady]);

  useEffect(() => {
    if (!applyingLimit.timedOut || !showApplying) return;
    resolveGen.current += 1;
    setApplying(false);
    setReady(false);
    setResolveError(tRef.current("modal.vault_root_setup.error_timeout"));
  }, [applyingLimit.timedOut, showApplying]);

  const bootSettled =
    settingsReady && !applying && (ready || screen !== null || resolveError !== null);

  useEffect(() => {
    if (bootSettled) setBooted(true);
  }, [bootSettled]);

  const retrySettingsLoad = () => {
    setSettingsLoadTimedOut(false);
    void reloadSettings().catch(() => {
      // Context sets settingsLoadFailed; Gate stays on Retry until a successful load.
    });
  };

  const settingsLoadStuck = settingsLoadTimedOut || settingsLoadFailed;
  const settingsLoadVisible = showLoadingSettings && (settingsLimit.visible || settingsLoadStuck);
  const applyingVisible = showApplying && applyingLimit.visible;

  const settingsLoadStatus = (
    <GateLoadingStatus
      message={
        settingsLoadTimedOut
          ? t("loading.timed_out")
          : settingsLoadFailed
            ? t("error.service_unavailable")
            : t("modal.vault_root_setup.loading_settings")
      }
      onRetry={settingsLoadStuck ? retrySettingsLoad : undefined}
    />
  );

  const applyingStatus = <GateLoadingStatus message={t("modal.vault_root_setup.busy")} />;

  const overlayStyle = [styles.overlay, { backgroundColor: colors.modalScrim }];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={styles.children}
        pointerEvents={blocking ? "none" : "auto"}
        accessibilityElementsHidden={blocking}
      >
        {children}
      </View>

      <VaultRootSetupScreen
        open={settingsReady && screen !== null && resolveError === null}
        screen={screen}
        ended={ended}
        onRetry={() => void runResolveRef.current()}
        onConfigured={configured}
      />

      {booted && settingsLoadVisible ? (
        <View style={overlayStyle} accessibilityRole="progressbar">
          {settingsLoadStatus}
        </View>
      ) : null}

      {booted && applyingVisible ? (
        <View style={overlayStyle} accessibilityRole="progressbar">
          {applyingStatus}
        </View>
      ) : null}

      <AppBootCover
        done={booted}
        status={
          booted
            ? null
            : settingsLoadVisible
              ? settingsLoadStatus
              : applyingVisible
                ? applyingStatus
                : null
        }
      />

      <Modal
        open={Boolean(envOverridePath && ready && settingsReady)}
        title={t("modal.vault_root_setup.title")}
        titleIcon="folder"
        onClose={() => setEnvOverridePath(null)}
        panelClassName="max-w-lg"
        dismissible
        footer={
          <ModalFooterActions layout="confirm">
            <Button
              label={t("action.continue")}
              variant="primary"
              onPress={() => setEnvOverridePath(null)}
            />
          </ModalFooterActions>
        }
      >
        <Text style={typography.bodyMuted}>
          {t("modal.vault_root_setup.env_override", { path: envOverridePath ?? "" })}
        </Text>
      </Modal>

      <Modal
        open={resolveError !== null}
        title={t("modal.vault_root_setup.title")}
        titleIcon="folder"
        onClose={() => undefined}
        panelClassName="max-w-lg"
        dismissible={false}
        footer={
          <ModalFooterActions layout="confirm">
            <Button
              label={t("action.retry")}
              variant="primary"
              onPress={() => {
                setResolveError(null);
                void runResolveRef.current();
              }}
            />
          </ModalFooterActions>
        }
      >
        <Text
          style={[typography.body, { color: colors.onErrorContainer }]}
          accessibilityRole="alert"
        >
          {resolveError ?? ""}
        </Text>
      </Modal>
      <FloatingToast toast={toast} onDismiss={dismissToast} />
    </View>
  );
}

interface GateLoadingStatusProps {
  message: string;
  onRetry?: () => void;
}

/** Spinner, or Retry once stuck. Reads the theme where it renders (cover vs overlay). */
function GateLoadingStatus({ message, onRetry }: GateLoadingStatusProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  return (
    <>
      {onRetry ? null : <ActivityIndicator size="large" color={colors.accent} />}
      <Text style={[typography.bodyMuted, styles.overlayText]}>{message}</Text>
      {onRetry ? <Button label={t("action.retry")} variant="primary" onPress={onRetry} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  children: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    zIndex: 100,
  },
  overlayText: { textAlign: "center" },
});
