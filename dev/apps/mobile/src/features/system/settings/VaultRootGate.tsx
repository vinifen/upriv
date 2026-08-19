import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  LOADING_BUDGET_MS,
  VAULT_ROOT_ERROR_CODES,
  isRpcError,
  type AppDistribution,
  type VaultRootMode,
  type VaultRootPresentationState,
} from "@upriv/shared";
import { useVaultRootService } from "@/platform/services";
import { useAppSettingsContext } from "./AppSettingsContext";
import { useTranslation } from "@/i18n";
import { mobileErrorI18nKey } from "@/lib/errorMessages";
import { useLoadingBudget } from "@/hooks/useLoadingBudget";
import { Button, LoadingBudgetHint, Modal } from "@/components/ui";
import { useTheme } from "@/theme";
import { spacing } from "@/theme/tokens";
import { VaultRootSetupScreen } from "./VaultRootSetupScreen";
import { VaultRootRepairModal } from "./VaultRootRepairModal";
import { VaultRootAliasRecoveryModal } from "./VaultRootAliasRecoveryModal";

interface VaultRootGateProps {
  children: ReactNode;
}

type RepairState = { targetPath: string; mode: VaultRootMode };

/** `RpcError` vault-root details often carry `{ path }` (SAF URI or FS). */
function pathFromRpcError(error: unknown): string {
  if (!isRpcError(error) || error.details == null || typeof error.details !== "object") {
    return "";
  }
  const path = (error.details as { path?: unknown }).path;
  return typeof path === "string" ? path.trim() : "";
}

/**
 * Resolves vault-root on launch. Blocks with setup/repair UI until a root exists.
 * RN parity for desktop `VaultRootGate`:
 * - `found` (with env override notice when `source === "explicit"`)
 * - `needs_setup` → Setup
 * - `incomplete` → Repair
 * - `alias_invalid` / `unreadable` / `io_error` → AliasRecovery
 * - custom_root empty path → recover from active alias or run recovery
 * - M8: needs_setup + valid default root → single retry
 * - Loading / applying budgets with retry
 * - Epoch soft-block while re-resolve runs after a mutation
 * - Resolve errors localized via `mobileErrorI18nKey`
 *
 * Children stay mounted under `pointerEvents="none"` while blocked.
 */
export function VaultRootGate({ children }: VaultRootGateProps) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const { colors, typography } = useTheme();
  const vaultRoot = useVaultRootService();
  const { settings, settingsReady, vaultRootEpoch, reloadSettings } = useAppSettingsContext();
  const [ready, setReady] = useState(false);
  const [applying, setApplying] = useState(false);
  const [setup, setSetup] = useState<{
    presentation: VaultRootPresentationState;
    distribution: AppDistribution;
  } | null>(null);
  const [repair, setRepair] = useState<RepairState | null>(null);
  const [aliasInvalidPath, setAliasInvalidPath] = useState<string | null>(null);
  const [recoveryPresentation, setRecoveryPresentation] =
    useState<VaultRootPresentationState | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  /** Non-blocking notice when env/CLI sets an explicit vault-root override. */
  const [envOverridePath, setEnvOverridePath] = useState<string | null>(null);
  const [settingsLoadTimedOut, setSettingsLoadTimedOut] = useState(false);
  const resolveGen = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const prevEpochRef = useRef(vaultRootEpoch);
  /** One retry when needs_setup but defaultRootStatus reports valid (M8). */
  const validDefaultRootRetryRef = useRef(false);

  const runResolve = useCallback(() => {
    if (!settingsReady) return;
    const gen = ++resolveGen.current;
    const app = settingsRef.current.app;
    let wireOrAliasPath = app.vault_root_mode === "custom_root" ? app.upriv_root_path.trim() : "";

    void (async () => {
      if (app.vault_root_mode === "custom_root" && !wireOrAliasPath) {
        try {
          const alias = await vaultRoot.readAlias();
          if (gen !== resolveGen.current) return;
          if (alias?.active && alias.path.trim()) {
            wireOrAliasPath = alias.path.trim();
          } else if (alias && !alias.active) {
            setSetup(null);
            setRepair(null);
            setResolveError(null);
            setApplying(false);
            setAliasInvalidPath(alias.path.trim() || "");
            setRecoveryPresentation({
              mode: app.vault_root_mode,
              defaultRootAnchor: "",
              aliasPath: "",
              rememberedAliasTarget: alias.path.trim() || null,
            });
            setReady(false);
            return;
          }
        } catch {
          /* fall through to resolve */
        }
      }

      try {
        const result = await vaultRoot.resolve({
          vaultRootMode: app.vault_root_mode,
          explicitPath: null,
        });
        if (gen !== resolveGen.current) return;
        if (result.status === "found") {
          validDefaultRootRetryRef.current = false;
          setSetup(null);
          setRepair(null);
          setAliasInvalidPath(null);
          setResolveError(null);
          setApplying(false);
          setReady(true);
          setEnvOverridePath(result.source === "explicit" ? result.rootPath : null);
          return;
        }

        if (app.vault_root_mode === "custom_root" && wireOrAliasPath) {
          try {
            const inspected = await vaultRoot.inspectAtPath(wireOrAliasPath);
            if (gen !== resolveGen.current) return;
            if (inspected.status === "incomplete") {
              setRepair({ targetPath: wireOrAliasPath, mode: "custom_root" });
              setSetup(null);
              setAliasInvalidPath(null);
              setResolveError(null);
              setApplying(false);
              setReady(false);
              return;
            }
            if (inspected.status === "unreadable") {
              setSetup(null);
              setRepair(null);
              setResolveError(null);
              setApplying(false);
              setAliasInvalidPath(wireOrAliasPath);
              setRecoveryPresentation({
                mode: app.vault_root_mode,
                defaultRootAnchor: "",
                aliasPath: "",
                rememberedAliasTarget: wireOrAliasPath || null,
              });
              setReady(false);
              return;
            }
            if (inspected.status === "absent") {
              // Custom root path remembered, but `.upriv/` was deleted → recovery
              // (recreate there / pick another / switch to default). Do not treat
              // a still-valid default_root as M8 "service unavailable".
              setSetup(null);
              setRepair(null);
              setResolveError(null);
              setApplying(false);
              setAliasInvalidPath(wireOrAliasPath);
              setRecoveryPresentation({
                mode: app.vault_root_mode,
                defaultRootAnchor: "",
                aliasPath: "",
                rememberedAliasTarget: wireOrAliasPath || null,
              });
              setReady(false);
              return;
            }
          } catch {
            if (gen !== resolveGen.current) return;
            setSetup(null);
            setRepair(null);
            setResolveError(null);
            setApplying(false);
            setAliasInvalidPath(wireOrAliasPath);
            setRecoveryPresentation({
              mode: app.vault_root_mode,
              defaultRootAnchor: "",
              aliasPath: "",
              rememberedAliasTarget: wireOrAliasPath || null,
            });
            setReady(false);
            return;
          }
        }

        try {
          const defaultRoot = await vaultRoot.defaultRootStatus();
          if (gen !== resolveGen.current) return;
          if (defaultRoot.status === "incomplete") {
            setRepair({ targetPath: defaultRoot.defaultRootAnchor, mode: "default_root" });
            setSetup(null);
            setAliasInvalidPath(null);
            setResolveError(null);
            setApplying(false);
            setReady(false);
            return;
          }
          if (defaultRoot.status === "unreadable") {
            setSetup(null);
            setRepair(null);
            setResolveError(null);
            setApplying(false);
            setAliasInvalidPath(defaultRoot.defaultRootAnchor.trim() || "");
            setRecoveryPresentation({
              mode: app.vault_root_mode,
              defaultRootAnchor: defaultRoot.defaultRootAnchor,
              aliasPath: "",
              rememberedAliasTarget: defaultRoot.defaultRootAnchor.trim() || null,
            });
            setReady(false);
            return;
          }
          if (defaultRoot.status === "valid") {
            // Custom root configured but resolve missed it, while default is still
            // valid — offer recovery for the remembered custom path (not M8).
            if (app.vault_root_mode === "custom_root" && wireOrAliasPath) {
              setSetup(null);
              setRepair(null);
              setResolveError(null);
              setApplying(false);
              setAliasInvalidPath(wireOrAliasPath);
              setRecoveryPresentation({
                mode: app.vault_root_mode,
                defaultRootAnchor: defaultRoot.defaultRootAnchor,
                aliasPath: "",
                rememberedAliasTarget: wireOrAliasPath || null,
              });
              setReady(false);
              return;
            }
            // needs_setup + valid default root is inconsistent — retry resolve once (M8).
            if (!validDefaultRootRetryRef.current) {
              validDefaultRootRetryRef.current = true;
              const retry = await vaultRoot.resolve({
                vaultRootMode: app.vault_root_mode,
                explicitPath: null,
              });
              if (gen !== resolveGen.current) return;
              if (retry.status === "found") {
                validDefaultRootRetryRef.current = false;
                setSetup(null);
                setRepair(null);
                setAliasInvalidPath(null);
                setResolveError(null);
                setApplying(false);
                setReady(true);
                setEnvOverridePath(retry.source === "explicit" ? retry.rootPath : null);
                return;
              }
            }
            setSetup(null);
            setRepair(null);
            setAliasInvalidPath(null);
            setApplying(false);
            setReady(false);
            setResolveError(tRef.current("error.service_unavailable"));
            return;
          }
        } catch {
          if (gen !== resolveGen.current) return;
          setSetup(null);
          setRepair(null);
          setResolveError(null);
          setApplying(false);
          setAliasInvalidPath("");
          setRecoveryPresentation({
            mode: app.vault_root_mode,
            defaultRootAnchor: "",
            aliasPath: "",
            rememberedAliasTarget: null,
          });
          setReady(false);
          return;
        }

        validDefaultRootRetryRef.current = false;
        if (gen !== resolveGen.current) return;
        setRepair(null);
        setAliasInvalidPath(null);
        setRecoveryPresentation(null);
        setResolveError(null);
        setApplying(false);
        let rememberedAliasTarget: string | null = null;
        try {
          const alias = await vaultRoot.readAlias();
          if (alias?.path.trim()) rememberedAliasTarget = alias.path.trim();
        } catch {
          /* optional enrichment */
        }
        if (gen !== resolveGen.current) return;
        setSetup({
          presentation: {
            mode: app.vault_root_mode,
            defaultRootAnchor: result.defaultRootAnchor,
            aliasPath: result.aliasPath,
            rememberedAliasTarget,
          },
          distribution: result.distribution,
        });
        setReady(false);
      } catch (error) {
        if (gen !== resolveGen.current) return;

        const aliasBroken =
          isRpcError(error) &&
          (error.code === VAULT_ROOT_ERROR_CODES.ALIAS_INVALID ||
            (error.code === VAULT_ROOT_ERROR_CODES.NOT_FOUND && Boolean(wireOrAliasPath)));
        if (aliasBroken) {
          let remembered = wireOrAliasPath;
          try {
            const alias = await vaultRoot.readAlias();
            if (alias?.path.trim()) remembered = alias.path.trim();
          } catch {
            /* keep wireOrAliasPath */
          }
          if (gen !== resolveGen.current) return;
          setSetup(null);
          setRepair(null);
          setResolveError(null);
          setApplying(false);
          setAliasInvalidPath(remembered || "");
          setRecoveryPresentation({
            mode: app.vault_root_mode,
            defaultRootAnchor: "",
            aliasPath: "",
            rememberedAliasTarget: remembered || null,
          });
          setReady(false);
          return;
        }

        const incomplete = isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE;
        if (incomplete) {
          // Settings load may have fallen back to defaults while SAF pref still
          // points at an incomplete tree — prefer wire/alias, then error.path, then alias.
          let repairPath = wireOrAliasPath || pathFromRpcError(error);
          if (!repairPath) {
            try {
              const alias = await vaultRoot.readAlias();
              if (alias?.path.trim()) repairPath = alias.path.trim();
            } catch {
              /* fall through */
            }
          }
          if (gen !== resolveGen.current) return;
          if (repairPath) {
            setRepair({ targetPath: repairPath, mode: "custom_root" });
            setSetup(null);
            setAliasInvalidPath(null);
            setRecoveryPresentation(null);
            setResolveError(null);
            setApplying(false);
            setReady(false);
            return;
          }
          try {
            const defaultRoot = await vaultRoot.defaultRootStatus();
            if (gen !== resolveGen.current) return;
            if (defaultRoot.status === "incomplete") {
              setRepair({ targetPath: defaultRoot.defaultRootAnchor, mode: "default_root" });
              setSetup(null);
              setAliasInvalidPath(null);
              setRecoveryPresentation(null);
              setResolveError(null);
              setApplying(false);
              setReady(false);
              return;
            }
          } catch {
            /* fall through to generic error */
          }
        }

        const ioLockout = isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.IO_ERROR;
        if (ioLockout) {
          let remembered = wireOrAliasPath;
          try {
            const alias = await vaultRoot.readAlias();
            if (alias?.path.trim()) remembered = alias.path.trim();
          } catch {
            /* keep wireOrAliasPath */
          }
          if (gen !== resolveGen.current) return;
          setSetup(null);
          setRepair(null);
          setResolveError(null);
          setApplying(false);
          setAliasInvalidPath(remembered || "");
          setRecoveryPresentation({
            mode: app.vault_root_mode,
            defaultRootAnchor: "",
            aliasPath: "",
            rememberedAliasTarget: remembered || null,
          });
          setReady(false);
          return;
        }

        setSetup(null);
        setRepair(null);
        setAliasInvalidPath(null);
        setRecoveryPresentation(null);
        setApplying(false);
        setReady(false);
        setResolveError(tRef.current(mobileErrorI18nKey(error, "error.service_unavailable")));
      }
    })();
  }, [settingsReady, vaultRoot]);

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
    runResolveRef.current();
  }, [settingsReady, vaultRootEpoch]);

  const clearBlocking = useCallback(() => {
    setSetup(null);
    setRepair(null);
    setAliasInvalidPath(null);
    setRecoveryPresentation(null);
    setResolveError(null);
    setApplying(true);
    setReady(false);
    runResolveRef.current();
  }, []);

  const blocking = !ready || !settingsReady || applying;
  const showLoadingSettings =
    !settingsReady &&
    setup === null &&
    repair === null &&
    aliasInvalidPath === null &&
    resolveError === null;
  const showApplying =
    applying &&
    settingsReady &&
    setup === null &&
    repair === null &&
    aliasInvalidPath === null &&
    resolveError === null;

  const settingsBudget = useLoadingBudget(
    showLoadingSettings && !settingsLoadTimedOut,
    LOADING_BUDGET_MS.settingsLoad,
  );
  const applyingBudget = useLoadingBudget(showApplying, LOADING_BUDGET_MS.vaultRootResolve);

  useEffect(() => {
    if (!settingsBudget.timedOut || !showLoadingSettings) return;
    setSettingsLoadTimedOut(true);
  }, [settingsBudget.timedOut, showLoadingSettings]);

  useEffect(() => {
    if (settingsReady) setSettingsLoadTimedOut(false);
  }, [settingsReady]);

  useEffect(() => {
    if (!applyingBudget.timedOut || !showApplying) return;
    resolveGen.current += 1;
    setApplying(false);
    setReady(false);
    setResolveError(tRef.current("modal.vault_root_setup.error_timeout"));
  }, [applyingBudget.timedOut, showApplying]);

  const retrySettingsLoad = () => {
    setSettingsLoadTimedOut(false);
    void reloadSettings().catch(() => {
      setSettingsLoadTimedOut(true);
    });
  };

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

      <VaultRootRepairModal
        open={
          settingsReady && repair !== null && resolveError === null && aliasInvalidPath === null
        }
        targetPath={repair?.targetPath ?? ""}
        mode={repair?.mode ?? "default_root"}
        onRepaired={() => clearBlocking()}
      />

      <VaultRootSetupScreen
        open={
          settingsReady &&
          setup !== null &&
          repair === null &&
          resolveError === null &&
          aliasInvalidPath === null
        }
        presentation={
          setup?.presentation ?? {
            mode: "default_root",
            defaultRootAnchor: "",
            aliasPath: "",
            rememberedAliasTarget: null,
          }
        }
        distribution={setup?.distribution ?? "installed"}
        onConfigured={() => clearBlocking()}
      />

      <VaultRootAliasRecoveryModal
        open={settingsReady && aliasInvalidPath !== null && resolveError === null}
        presentation={
          recoveryPresentation ?? {
            mode: settings.app.vault_root_mode,
            defaultRootAnchor: "",
            aliasPath: "",
            rememberedAliasTarget: aliasInvalidPath,
          }
        }
        onRecovered={() => clearBlocking()}
        onDefaultRootIncomplete={(defaultRootAnchor) => {
          setAliasInvalidPath(null);
          setRecoveryPresentation(null);
          setResolveError(null);
          setSetup(null);
          setRepair({ targetPath: defaultRootAnchor, mode: "default_root" });
        }}
        onCustomIncomplete={(path) => {
          setAliasInvalidPath(null);
          setRecoveryPresentation(null);
          setResolveError(null);
          setSetup(null);
          setRepair({ targetPath: path, mode: "custom_root" });
        }}
      />

      {showLoadingSettings && (settingsBudget.visible || settingsLoadTimedOut) ? (
        <View style={overlayStyle} accessibilityRole="progressbar">
          {settingsLoadTimedOut ? null : <ActivityIndicator size="large" color={colors.accent} />}
          <Text style={[typography.bodyMuted, styles.overlayText]}>
            {settingsLoadTimedOut
              ? t("loading.timed_out")
              : t("modal.vault_root_setup.loading_settings")}
          </Text>
          {settingsLoadTimedOut ? (
            <Button label={t("action.retry")} variant="accent" onPress={retrySettingsLoad} />
          ) : (
            <LoadingBudgetHint
              budgetMs={settingsBudget.budgetMs}
              remainingMs={settingsBudget.remainingMs}
            />
          )}
        </View>
      ) : null}

      {showApplying && applyingBudget.visible ? (
        <View style={overlayStyle} accessibilityRole="progressbar">
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[typography.bodyMuted, styles.overlayText]}>
            {t("modal.vault_root_setup.busy")}
          </Text>
          <LoadingBudgetHint
            budgetMs={applyingBudget.budgetMs}
            remainingMs={applyingBudget.remainingMs}
          />
        </View>
      ) : null}

      <Modal
        open={Boolean(envOverridePath && ready && settingsReady)}
        title={t("modal.vault_root_setup.title")}
        onClose={() => setEnvOverridePath(null)}
        panelClassName="max-w-lg"
        dismissible
        footer={
          <View style={styles.actionsCol}>
            <Button
              label={t("action.continue")}
              variant="accent"
              onPress={() => setEnvOverridePath(null)}
            />
          </View>
        }
      >
        <Text style={typography.bodyMuted}>
          {t("modal.vault_root_setup.env_override", { path: envOverridePath ?? "" })}
        </Text>
      </Modal>

      <Modal
        open={resolveError !== null}
        title={t("modal.vault_root_setup.title")}
        onClose={() => undefined}
        panelClassName="max-w-lg"
        dismissible={false}
        footer={
          <View style={styles.actionsCol}>
            <Button
              label={t("action.retry")}
              variant="accent"
              onPress={() => {
                setResolveError(null);
                runResolveRef.current();
              }}
            />
          </View>
        }
      >
        <Text
          style={[typography.body, { color: colors.onErrorContainer }]}
          accessibilityRole="alert"
        >
          {resolveError ?? ""}
        </Text>
      </Modal>
    </View>
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
  actionsCol: { gap: spacing.sm },
});
