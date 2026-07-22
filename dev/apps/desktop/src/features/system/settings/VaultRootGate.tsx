import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { useAppSettingsContext } from "./AppSettingsContext";
import { useVaultRootService } from "@/platform/services";
import {
  VAULT_ROOT_ERROR_CODES,
  isRpcError,
  type AppDistribution,
  type VaultRootMode,
  type VaultRootPresentationState,
} from "@upriv/shared";
import { VaultRootAliasRecoveryModal } from "./VaultRootAliasRecoveryModal";
import { VaultRootRepairModal } from "./VaultRootRepairModal";
import { VaultRootSetupModal } from "./VaultRootSetupModal";

interface VaultRootGateProps {
  children: ReactNode;
}

type RepairState = { targetPath: string; mode: VaultRootMode };

/**
 * Resolves vault-root on launch. Blocks with setup/repair UI until a root exists.
 * Incomplete default_root or custom `.upriv/` → repair modal (rename recommended / delete).
 * Invalid active alias (e.g. unmounted drive) → dedicated recovery UI.
 *
 * Always resolves with `explicitPath: null` so env/CLI overrides stay in Rust only.
 * `custom_root` mode uses `vaultRootMode` + alias; wire/alias paths are for UX inspect only.
 *
 * Children stay mounted (pointer-events blocked while not ready) so providers keep state.
 * Re-resolves when settings become ready and when `vaultRootEpoch` bumps.
 * Epoch bumps while already ready soft-block via the applying overlay until resolve settles.
 * After Setup/Repair/Recovery success, shows a non-dismissible applying overlay until
 * resolve confirms `found`.
 * While settings are still loading, shows a distinct loading overlay (not applying).
 */
export function VaultRootGate({ children }: VaultRootGateProps) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const vaultRoot = useVaultRootService();
  const { settings, settingsReady, vaultRootEpoch } = useAppSettingsContext();
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
    // Display / inspect only — never passed as resolve `explicitPath`.
    let wireOrAliasPath = app.vault_root_mode === "custom_root" ? app.upriv_root_path.trim() : "";

    void (async () => {
      // `custom_root` mode with empty wire path: recover from active alias for UX
      // (setAliasInvalidPath / fill path for inspect) — do not inject into resolve.
      if (app.vault_root_mode === "custom_root" && !wireOrAliasPath) {
        try {
          const alias = await vaultRoot.readAlias();
          if (gen !== resolveGen.current) return;
          if (alias?.active && alias.path.trim()) {
            wireOrAliasPath = alias.path.trim();
          } else if (alias && !alias.active) {
            // Custom settings without active alias → recovery / setup.
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
          // Fall through to resolve; alias path stays empty for inspect.
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
          // Gate never sends explicitPath — `source === "explicit"` means env/CLI only.
          setEnvOverridePath(result.source === "explicit" ? result.rootPath : null);
          return;
        }

        // Custom needs_setup: inspect wire/alias path for incomplete/unreadable.
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

        // Default-root / no custom path: broken default_root `.upriv` → repair before first-run setup.
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
          // Optional enrichment for Setup labels.
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
            // Keep wireOrAliasPath.
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

        // Incomplete from resolve: use known path directly (no redundant inspect).
        const incomplete = isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE;
        if (incomplete) {
          if (wireOrAliasPath) {
            setRepair({ targetPath: wireOrAliasPath, mode: "custom_root" });
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
            // Fall through to generic error.
          }
        }

        const ioLockout = isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.IO_ERROR;
        if (ioLockout) {
          let remembered = wireOrAliasPath;
          try {
            const alias = await vaultRoot.readAlias();
            if (alias?.path.trim()) remembered = alias.path.trim();
          } catch {
            // Keep wireOrAliasPath.
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
        setResolveError(tRef.current(desktopErrorI18nKey(error, "error.service_unavailable")));
      }
    })();
  }, [settingsReady, vaultRoot]);

  useEffect(() => {
    if (vaultRootEpoch !== prevEpochRef.current) {
      prevEpochRef.current = vaultRootEpoch;
      // Soft-block children on the previous root while re-resolve runs after a mutation.
      if (readyRef.current) {
        setApplying(true);
      }
    }
    runResolve();
  }, [settingsReady, vaultRootEpoch, runResolve]);

  const clearBlocking = () => {
    setSetup(null);
    setRepair(null);
    setAliasInvalidPath(null);
    setRecoveryPresentation(null);
    setResolveError(null);
    setApplying(true);
    setReady(false);
    runResolve();
  };

  const blocking = !ready || !settingsReady;
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

  return (
    <>
      <div
        aria-hidden={blocking || undefined}
        className={blocking ? "pointer-events-none select-none" : undefined}
      >
        {children}
      </div>
      <VaultRootRepairModal
        open={
          settingsReady && repair !== null && resolveError === null && aliasInvalidPath === null
        }
        targetPath={repair?.targetPath ?? ""}
        mode={repair?.mode ?? "default_root"}
        onRepaired={() => clearBlocking()}
      />
      <VaultRootSetupModal
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
        distribution={setup?.distribution ?? "portable"}
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
      {showLoadingSettings ? (
        <Modal
          open
          title={t("modal.vault_root_setup.title")}
          onClose={() => undefined}
          dismissible={false}
          panelClassName="max-w-lg"
          rootClassName="z-[200]"
        >
          <p className="text-sm leading-relaxed text-on-surface-variant" role="status">
            {t("modal.vault_root_setup.loading_settings")}
          </p>
        </Modal>
      ) : null}
      {showApplying ? (
        <Modal
          open
          title={t("modal.vault_root_setup.title")}
          onClose={() => undefined}
          dismissible={false}
          panelClassName="max-w-lg"
          rootClassName="z-[200]"
        >
          <p className="text-sm leading-relaxed text-on-surface-variant" role="status">
            {t("modal.vault_root_setup.busy")}
          </p>
        </Modal>
      ) : null}
      {envOverridePath && ready && settingsReady ? (
        <Modal
          open
          title={t("modal.vault_root_setup.title")}
          onClose={() => setEnvOverridePath(null)}
          dismissible
          panelClassName="max-w-lg"
          rootClassName="z-[200]"
          footer={
            <div className="flex justify-end">
              <Button variant="primary" size="md" onClick={() => setEnvOverridePath(null)}>
                {t("action.continue")}
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed text-on-surface-variant" role="status">
            {t("modal.vault_root_setup.env_override", { path: envOverridePath })}
          </p>
        </Modal>
      ) : null}
      {resolveError ? (
        <Modal
          open
          title={t("modal.vault_root_setup.title")}
          onClose={() => undefined}
          dismissible={false}
          panelClassName="max-w-lg"
          rootClassName="z-[200]"
          footer={
            <div className="flex justify-end">
              <Button variant="primary" size="md" onClick={() => runResolve()}>
                {t("action.retry")}
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed text-on-surface-variant" role="alert">
            {resolveError}
          </p>
        </Modal>
      ) : null}
    </>
  );
}
