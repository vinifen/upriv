import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { useAppSettingsContext } from "./AppSettingsContext";
import { useVaultRootService } from "@/platform/services";
import { VAULT_ROOT_ERROR_CODES, isRpcError } from "@upriv/shared";
import { VaultRootAliasRecoveryModal } from "./VaultRootAliasRecoveryModal";
import { VaultRootRepairModal } from "./VaultRootRepairModal";
import { VaultRootSetupModal } from "./VaultRootSetupModal";

interface VaultRootGateProps {
  children: ReactNode;
}

type RepairState = { targetPath: string; mode: "nearby" | "fixed" };

/**
 * Resolves vault-root on launch. Blocks with setup/repair UI until a root exists.
 * Incomplete nearby or fixed `.upriv/` → repair modal (rename recommended / delete).
 * Invalid active alias (e.g. unmounted drive) → dedicated recovery UI.
 *
 * Children stay mounted (pointer-events blocked while not ready) so providers keep state.
 * Re-resolves when settings become ready and when `vaultRootEpoch` bumps — keeps
 * `ready` true until the new resolve proves the root is missing/broken (no blank freeze).
 */
export function VaultRootGate({ children }: VaultRootGateProps) {
  const { t } = useTranslation();
  const vaultRoot = useVaultRootService();
  const { settings, settingsReady, vaultRootEpoch } = useAppSettingsContext();
  const [ready, setReady] = useState(false);
  const [setup, setSetup] = useState<{ nearbyAnchor: string; aliasPath: string } | null>(null);
  const [repair, setRepair] = useState<RepairState | null>(null);
  const [aliasInvalidPath, setAliasInvalidPath] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const resolveGen = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const runResolve = useCallback(() => {
    if (!settingsReady) return;
    const gen = ++resolveGen.current;
    const app = settingsRef.current.app;
    const fixedPath = app.auto_detect_vault_root ? "" : app.upriv_root_path.trim();
    // Keep `ready` until we know the new result needs a blocking UI (avoids freezing
    // the whole app on every vaultRootEpoch bump).
    void vaultRoot
      .resolve({
        autoDetect: app.auto_detect_vault_root,
        explicitPath: fixedPath || null,
      })
      .then(async (result) => {
        if (gen !== resolveGen.current) return;
        if (result.status === "found") {
          setSetup(null);
          setRepair(null);
          setAliasInvalidPath(null);
          setResolveError(null);
          setReady(true);
          return;
        }

        // Fixed path configured but resolve returned needs_setup — inspect that path.
        if (fixedPath) {
          try {
            const inspected = await vaultRoot.inspectAtPath(fixedPath);
            if (gen !== resolveGen.current) return;
            if (inspected.status === "incomplete") {
              setRepair({ targetPath: fixedPath, mode: "fixed" });
              setSetup(null);
              setAliasInvalidPath(null);
              setResolveError(null);
              setReady(false);
              return;
            }
            if (inspected.status === "unreadable") {
              setSetup(null);
              setRepair(null);
              setAliasInvalidPath(null);
              setReady(false);
              setResolveError(t("modal.vault_root_setup.error_io"));
              return;
            }
          } catch {
            if (gen !== resolveGen.current) return;
            setSetup(null);
            setRepair(null);
            setAliasInvalidPath(null);
            setReady(false);
            setResolveError(t("modal.vault_root_setup.error_io"));
            return;
          }
        }

        // Auto / no fixed: broken nearby `.upriv` → repair before first-run setup.
        try {
          const nearby = await vaultRoot.nearbyStatus();
          if (gen !== resolveGen.current) return;
          if (nearby.status === "incomplete") {
            setRepair({ targetPath: nearby.nearbyAnchor, mode: "nearby" });
            setSetup(null);
            setAliasInvalidPath(null);
            setResolveError(null);
            setReady(false);
            return;
          }
          if (nearby.status === "unreadable") {
            setSetup(null);
            setRepair(null);
            setAliasInvalidPath(null);
            setReady(false);
            setResolveError(t("modal.vault_root_setup.error_io"));
            return;
          }
        } catch {
          if (gen !== resolveGen.current) return;
          setSetup(null);
          setRepair(null);
          setAliasInvalidPath(null);
          setReady(false);
          setResolveError(t("modal.vault_root_setup.error_io"));
          return;
        }

        if (gen !== resolveGen.current) return;
        setRepair(null);
        setAliasInvalidPath(null);
        setResolveError(null);
        setSetup({
          nearbyAnchor: result.nearbyAnchor,
          aliasPath: result.aliasPath,
        });
        setReady(false);
      })
      .catch(async (error) => {
        if (gen !== resolveGen.current) return;

        const aliasBroken =
          isRpcError(error) &&
          (error.code === VAULT_ROOT_ERROR_CODES.ALIAS_INVALID ||
            // Fixed/explicit path with no `.upriv` at all — same recovery as invalid alias
            // (Retry alone cannot fix a missing root).
            (error.code === VAULT_ROOT_ERROR_CODES.NOT_FOUND && Boolean(fixedPath)));
        if (aliasBroken) {
          let remembered = fixedPath;
          try {
            const alias = await vaultRoot.readAlias();
            if (alias?.path.trim()) remembered = alias.path.trim();
          } catch {
            // Keep fixedPath.
          }
          if (gen !== resolveGen.current) return;
          setSetup(null);
          setRepair(null);
          setResolveError(null);
          setAliasInvalidPath(remembered || "");
          setReady(false);
          return;
        }

        const incomplete = isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.INCOMPLETE;
        if (incomplete) {
          // Prefer the configured fixed path; else inspect nearby.
          if (fixedPath) {
            setRepair({ targetPath: fixedPath, mode: "fixed" });
            setSetup(null);
            setAliasInvalidPath(null);
            setResolveError(null);
            setReady(false);
            return;
          }
          try {
            const nearby = await vaultRoot.nearbyStatus();
            if (gen !== resolveGen.current) return;
            if (nearby.status === "incomplete") {
              setRepair({ targetPath: nearby.nearbyAnchor, mode: "nearby" });
              setSetup(null);
              setAliasInvalidPath(null);
              setResolveError(null);
              setReady(false);
              return;
            }
          } catch {
            // Fall through to generic error.
          }
        }

        setSetup(null);
        setRepair(null);
        setAliasInvalidPath(null);
        setReady(false);
        setResolveError(t(desktopErrorI18nKey(error, "error.service_unavailable")));
      });
  }, [settingsReady, t, vaultRoot]);

  useEffect(() => {
    runResolve();
  }, [settingsReady, vaultRootEpoch, runResolve]);

  const clearBlocking = () => {
    setSetup(null);
    setRepair(null);
    setAliasInvalidPath(null);
    runResolve();
  };

  const blocking = !ready;

  return (
    <>
      <div
        aria-hidden={blocking || undefined}
        className={blocking ? "pointer-events-none select-none" : undefined}
      >
        {children}
      </div>
      <VaultRootRepairModal
        open={repair !== null && resolveError === null && aliasInvalidPath === null}
        targetPath={repair?.targetPath ?? ""}
        mode={repair?.mode ?? "nearby"}
        onRepaired={() => clearBlocking()}
      />
      <VaultRootSetupModal
        open={
          setup !== null && repair === null && resolveError === null && aliasInvalidPath === null
        }
        nearbyAnchor={setup?.nearbyAnchor ?? ""}
        aliasPath={setup?.aliasPath ?? ""}
        onConfigured={() => clearBlocking()}
      />
      <VaultRootAliasRecoveryModal
        open={aliasInvalidPath !== null && resolveError === null}
        rememberedPath={aliasInvalidPath ?? ""}
        onRecovered={() => clearBlocking()}
        onNearbyIncomplete={(nearbyAnchor) => {
          setAliasInvalidPath(null);
          setResolveError(null);
          setSetup(null);
          setRepair({ targetPath: nearbyAnchor, mode: "nearby" });
        }}
      />
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
