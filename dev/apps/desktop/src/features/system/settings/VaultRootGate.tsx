import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, Modal, Toast } from "@/components/ui";
import { useOperationLimit, useToast } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { desktopErrorI18nKey } from "@/lib/errorMessages";
import { useAppSettingsContext } from "./AppSettingsContext";
import { useVaultRootService } from "@/platform/services";
import {
  VAULT_ROOT_ERROR_CODES,
  dataFolderChangeMessage,
  isRpcError,
  type FolderSwitch,
} from "@upriv/shared";
import { VaultRootSetupModal, type SetupScreen } from "./VaultRootSetupModal";
import { AppBootCover } from "./AppBootCover";

function BootSpinner() {
  return (
    <span
      className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
      aria-hidden
    />
  );
}

interface VaultRootGateProps {
  children: ReactNode;
}

/**
 * Resolves the data folder on launch and blocks with the data folder list
 * until one is in use: the first run, a selected choice that did not answer
 * (with the search for one that does), a broken `.upriv/` (Repair), or a
 * list file that cannot be read. A data folder lost while Upriv runs stays
 * selected, so the resolve after it lands on the same screens.
 *
 * `UPRIV_VAULT_ROOT` stays in Rust: resolve takes no path from here.
 *
 * Children stay mounted (`inert` + pointer-events while not ready) so providers keep state.
 * Re-resolves when settings become ready and when `vaultRootEpoch` bumps.
 * Epoch bumps while already ready soft-block via the applying overlay until resolve settles.
 * After the blocking screen applies, shows a non-dismissible applying overlay until
 * resolve confirms `found`.
 * While settings are still loading, shows a distinct loading overlay (not applying).
 * On launch, `AppBootCover` hides everything (in the default theme) until settings and
 * the first resolve settle, so saved theme/locale never flip in after the first paint.
 */
export function VaultRootGate({ children }: VaultRootGateProps) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
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
  const [relocateNotice, setRelocateNotice] = useState<{
    kind: "left_behind" | "move_failed";
    path: string;
  } | null>(null);
  /** The launch notice stays dismissed for the rest of this process. */
  const relocateSeen = useRef(false);
  const [settingsLoadTimedOut, setSettingsLoadTimedOut] = useState(false);
  const resolveGen = useRef(0);
  const childrenWrapRef = useRef<HTMLDivElement>(null);
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

  const runResolve = useCallback(() => {
    if (!settingsReady) return;
    const gen = ++resolveGen.current;
    void (async () => {
      try {
        const result = await vaultRoot.resolve();
        if (gen !== resolveGen.current) return;
        if (!relocateSeen.current && result.relocateNotice && result.relocatePath) {
          relocateSeen.current = true;
          setRelocateNotice({ kind: result.relocateNotice, path: result.relocatePath });
        }
        switch (result.status) {
          case "found":
            setScreen(null);
            setResolveError(null);
            setApplying(false);
            setReady(true);
            setEnvOverridePath(result.source === "explicit" ? result.rootPath : null);
            return;
          case "needs_setup":
            block({ kind: "first_run", distribution: result.distribution }, null, result.ended);
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
          block(null, tRef.current(desktopErrorI18nKey(error, "error.service_unavailable")));
        }
      }
    })();
  }, [block, settingsReady, vaultRoot]);

  // Resolve when settings become ready or vault-root epoch bumps — not when
  // `runResolve` identity changes (avoids duplicate DEBUG resolve probes).
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

  const configured = (change: FolderSwitch | null, ended: readonly string[]) => {
    setScreen(null);
    setResolveError(null);
    setApplying(true);
    setReady(false);
    const message = dataFolderChangeMessage(change, ended, t);
    if (message) showToast(message);
    runResolve();
  };

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
    // Invalidate in-flight `runResolve` so a late success cannot setReady after timeout.
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
  const settingsLoadMessage = settingsLoadTimedOut
    ? t("loading.timed_out")
    : settingsLoadFailed
      ? t("error.service_unavailable")
      : t("modal.vault_root_setup.loading_settings");

  // `aria-hidden` does not take the list out of tab order. Without `inert`,
  // Electron focuses the first header button (⋮) on launch.
  useLayoutEffect(() => {
    const wrap = childrenWrapRef.current;
    if (wrap) wrap.inert = blocking;
    if (blocking || !wrap) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && wrap.contains(active)) active.blur();
  }, [blocking]);

  return (
    <>
      <div
        ref={childrenWrapRef}
        aria-hidden={blocking || undefined}
        className={blocking ? "pointer-events-none select-none" : undefined}
      >
        {children}
      </div>
      <VaultRootSetupModal
        open={settingsReady && screen !== null && resolveError === null}
        screen={screen}
        ended={ended}
        onRetry={runResolve}
        onConfigured={configured}
      />
      <AppBootCover
        done={booted}
        status={
          booted ? null : settingsLoadVisible ? (
            <>
              {settingsLoadStuck ? null : <BootSpinner />}
              <p
                className="max-w-sm text-sm leading-relaxed text-on-surface-variant"
                role={settingsLoadStuck ? "alert" : "status"}
              >
                {settingsLoadMessage}
              </p>
              {settingsLoadStuck ? (
                <Button variant="primary" size="md" onClick={retrySettingsLoad}>
                  {t("action.retry")}
                </Button>
              ) : null}
            </>
          ) : applyingVisible ? (
            <>
              <BootSpinner />
              <p className="max-w-sm text-sm leading-relaxed text-on-surface-variant" role="status">
                {t("modal.vault_root_setup.busy")}
              </p>
            </>
          ) : null
        }
      />
      {booted && settingsLoadVisible ? (
        <Modal
          open
          title={t("modal.vault_root_setup.title")}
          titleIcon="folder"
          onClose={() => undefined}
          dismissible={false}
          panelClassName="max-w-lg"
          rootClassName="z-[200]"
          footer={
            settingsLoadStuck ? (
              <div className="flex justify-end">
                <Button variant="primary" size="md" onClick={retrySettingsLoad}>
                  {t("action.retry")}
                </Button>
              </div>
            ) : undefined
          }
        >
          <p className="text-sm leading-relaxed text-on-surface-variant" role="status">
            {settingsLoadMessage}
          </p>
        </Modal>
      ) : null}
      {booted && applyingVisible ? (
        <Modal
          open
          title={t("modal.vault_root_setup.title")}
          titleIcon="folder"
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
      {relocateNotice && settingsReady ? (
        <Modal
          open
          title={t("modal.vault_root_setup.title")}
          titleIcon="folder"
          onClose={() => setRelocateNotice(null)}
          dismissible
          panelClassName="max-w-lg"
          rootClassName="z-[200]"
          footer={
            <div className="flex justify-end">
              <Button variant="primary" size="md" onClick={() => setRelocateNotice(null)}>
                {t("action.continue")}
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-relaxed text-on-surface-variant" role="status">
            {t(
              relocateNotice.kind === "left_behind"
                ? "modal.vault_root_setup.relocate_left_behind"
                : "modal.vault_root_setup.relocate_move_failed",
              { path: relocateNotice.path },
            )}
          </p>
        </Modal>
      ) : null}
      {envOverridePath && ready && settingsReady ? (
        <Modal
          open
          title={t("modal.vault_root_setup.title")}
          titleIcon="folder"
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
          titleIcon="folder"
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
      <Toast toast={toast} onDismiss={dismissToast} className="z-[220]" />
    </>
  );
}
