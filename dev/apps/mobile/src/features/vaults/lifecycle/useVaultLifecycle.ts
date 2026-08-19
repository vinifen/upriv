import { useCallback, useMemo, useRef } from "react";
import {
  CLOSING_PIPELINE_STEPS,
  OPENING_PIPELINE_STEPS,
  storageModeSealOnly,
  touchVaultLastAccessed,
  type VaultLifecycleIntent,
  type VaultLifecycleRequest,
  type VaultListItem,
  type VaultPersistence,
  type VaultSession,
} from "@upriv/shared";
import { useVaultLifecycleService } from "@/platform/services";
import { useTranslation, type I18nKey } from "@/i18n";
import { useVaultPipelineRun } from "./useVaultPipelineRun";

export type SetVaultRuntimeState = (
  vaultId: string,
  patch: {
    session: VaultSession | null;
    persistence?: VaultPersistence;
    canSeal?: boolean;
    lastAccessedAt?: string;
    lastAccessedWhen?: string;
  },
) => void;

interface UseVaultLifecycleOptions {
  vaults: VaultListItem[];
  setVaultRuntimeState: SetVaultRuntimeState;
  lifecycleRequest: VaultLifecycleRequest | null;
  setLifecycleRequest: (next: VaultLifecycleRequest | null) => void;
  showToast: (message: string, durationMs?: number) => void;
  dismissToast: () => void;
}

export function useVaultLifecycle({
  vaults,
  setVaultRuntimeState,
  lifecycleRequest,
  setLifecycleRequest,
  showToast,
  dismissToast,
}: UseVaultLifecycleOptions) {
  const { t } = useTranslation();
  const lifecycleService = useVaultLifecycleService();
  const pipeline = useVaultPipelineRun();
  const pipelineBackgroundRef = useRef(false);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const closeStartedWhileOpenRef = useRef(new Map<string, boolean>());
  const submittingRef = useRef(false);

  const lifecycleVault = useMemo(() => {
    if (!lifecycleRequest) return null;
    return vaults.find((v) => v.id === lifecycleRequest.vaultId) ?? null;
  }, [lifecycleRequest, vaults]);

  const pipelineVault = useMemo(() => {
    if (!pipeline.run) return null;
    return vaults.find((v) => v.id === pipeline.run!.vaultId) ?? null;
  }, [pipeline.run, vaults]);

  const revertCloseFailure = useCallback(
    (vaultId: string) => {
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      if (!vault) return;
      const wasOpen = closeStartedWhileOpenRef.current.get(vaultId) ?? false;
      closeStartedWhileOpenRef.current.delete(vaultId);
      if (wasOpen) {
        setVaultRuntimeState(vaultId, {
          session: "open",
          persistence: storageModeSealOnly(vault.storageMode) ? "sealed" : "closed",
        });
        return;
      }
      setVaultRuntimeState(vaultId, { session: null, persistence: "closed" });
    },
    [setVaultRuntimeState],
  );

  const handlePipelineError = useCallback(
    (vaultId: string, kind: "open" | "close" | "seal", errorI18nKey: I18nKey) => {
      const wasBackground = pipelineBackgroundRef.current;
      pipelineBackgroundRef.current = false;
      dismissToast();
      showToast(t(errorI18nKey), 8000);
      if (kind === "close" || kind === "seal") {
        revertCloseFailure(vaultId);
      }
      if (wasBackground) {
        pipeline.dismissFailure();
      }
    },
    [dismissToast, pipeline, revertCloseFailure, showToast, t],
  );

  const finishOpenVault = useCallback(
    (vaultId: string) => {
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      setVaultRuntimeState(vaultId, {
        session: "open",
        persistence: vault && storageModeSealOnly(vault.storageMode) ? "sealed" : "closed",
        ...touchVaultLastAccessed(t("vault.last_accessed.just_now")),
      });
    },
    [setVaultRuntimeState, t],
  );

  const finishCloseOrSeal = useCallback(
    (vaultId: string, intent: Extract<VaultLifecycleIntent, "close" | "seal">) => {
      if (intent === "close") {
        setVaultRuntimeState(vaultId, { session: null, persistence: "closed" });
      } else {
        setVaultRuntimeState(vaultId, { session: null, persistence: "sealed" });
      }
      lifecycleService.clearPasswordInSession(vaultId);
      closeStartedWhileOpenRef.current.delete(vaultId);
    },
    [lifecycleService, setVaultRuntimeState],
  );

  const notifyPipelineComplete = useCallback(
    (vaultId: string, kind: "open" | "close" | "seal") => {
      dismissToast();
      if (!pipelineBackgroundRef.current) return;
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      if (!vault) return;
      const key =
        kind === "open"
          ? "toast.pipeline_complete_open"
          : kind === "seal"
            ? "toast.pipeline_complete_seal"
            : "toast.pipeline_complete_close";
      showToast(t(key, { name: vault.displayName }));
      pipelineBackgroundRef.current = false;
    },
    [dismissToast, showToast, t],
  );

  const startOpenPipeline = useCallback(
    (vaultId: string): boolean => {
      pipelineBackgroundRef.current = false;
      return pipeline.start({
        vaultId,
        kind: "open",
        stepCount: lifecycleService.openingStepCount,
        runPipeline: lifecycleService.runOpeningPipeline.bind(lifecycleService),
        onComplete: () => {
          finishOpenVault(vaultId);
          notifyPipelineComplete(vaultId, "open");
        },
        onError: (errorI18nKey) => handlePipelineError(vaultId, "open", errorI18nKey),
      });
    },
    [finishOpenVault, handlePipelineError, lifecycleService, notifyPipelineComplete, pipeline],
  );

  const startClosePipeline = useCallback(
    (vaultId: string, intent: Extract<VaultLifecycleIntent, "close" | "seal">): boolean => {
      const vault = vaultsRef.current.find((item) => item.id === vaultId);
      closeStartedWhileOpenRef.current.set(vaultId, vault?.session === "open");
      setVaultRuntimeState(vaultId, {
        session: null,
        persistence: intent === "seal" ? "sealed" : "closed",
      });
      pipelineBackgroundRef.current = false;
      return pipeline.start({
        vaultId,
        kind: intent,
        stepCount: lifecycleService.closingStepCount,
        runPipeline: lifecycleService.runClosingPipeline.bind(lifecycleService),
        onComplete: () => {
          finishCloseOrSeal(vaultId, intent);
          notifyPipelineComplete(vaultId, intent);
        },
        onError: (errorI18nKey) => handlePipelineError(vaultId, intent, errorI18nKey),
      });
    },
    [
      finishCloseOrSeal,
      handlePipelineError,
      lifecycleService,
      notifyPipelineComplete,
      pipeline,
      setVaultRuntimeState,
    ],
  );

  const requestLifecycle = useCallback(
    (vaultId: string, intent: VaultLifecycleIntent) => {
      if (pipeline.run?.vaultId === vaultId) return;
      setLifecycleRequest({ vaultId, intent });
    },
    [pipeline.run?.vaultId, setLifecycleRequest],
  );

  const confirmLifecycle = useCallback(
    (password: string | null) => {
      if (!lifecycleRequest || submittingRef.current) return;
      const { vaultId, intent } = lifecycleRequest;
      submittingRef.current = true;
      if (password) {
        lifecycleService.setPasswordInSession(vaultId, password);
      }
      setLifecycleRequest(null);
      const started =
        intent === "unlock" ? startOpenPipeline(vaultId) : startClosePipeline(vaultId, intent);
      submittingRef.current = false;
      if (!started) {
        showToast(t("toast.pipeline_busy"));
      }
    },
    [
      lifecycleRequest,
      lifecycleService,
      setLifecycleRequest,
      showToast,
      startClosePipeline,
      startOpenPipeline,
      t,
    ],
  );

  const cancelLifecycle = useCallback(() => {
    setLifecycleRequest(null);
  }, [setLifecycleRequest]);

  const sendPipelineToBackground = useCallback(() => {
    pipelineBackgroundRef.current = true;
    pipeline.sendToBackground();
  }, [pipeline]);

  const overlayProps = useMemo(() => {
    const run = pipeline.run;
    if (!run || !run.foreground) {
      return { open: false as const };
    }
    const isOpen = run.kind === "open";
    return {
      open: true as const,
      title: t(
        isOpen
          ? "open.overlay.title"
          : run.kind === "seal"
            ? "close.overlay.title_seal"
            : "close.overlay.title_close",
        {
          name: pipelineVault?.displayName ?? "",
        },
      ),
      hint: t(isOpen ? "open.overlay.hint" : "close.overlay.hint"),
      stepKeys: (isOpen ? OPENING_PIPELINE_STEPS : CLOSING_PIPELINE_STEPS) as readonly I18nKey[],
      activeStep: run.activeStep,
      errorKey: run.errorKey ?? null,
    };
  }, [pipeline.run, pipelineVault?.displayName, t]);

  return {
    lifecycleVault,
    lifecycleIntent: lifecycleRequest?.intent ?? null,
    confirmLifecycle,
    cancelLifecycle,
    requestLifecycle,
    pipelineVault,
    pipelineOverlay: overlayProps,
    sendPipelineToBackground,
    dismissPipelineFailure: pipeline.dismissFailure,
    openingVaultIds: pipeline.openingVaultIds,
    closingVaultIds: pipeline.closingVaultIds,
  };
}
