import { useCallback, useEffect, useRef, useState } from "react";
import { useVaultService } from "@/platform/services";
import type { VaultSettingsConfig } from "@upriv/shared";

export function useVaultSettings(vaultId: string | null, open: boolean) {
  const vaultService = useVaultService();
  const [config, setConfig] = useState<VaultSettingsConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const genRef = useRef(0);

  useEffect(() => {
    if (!open || !vaultId) {
      genRef.current += 1;
      setConfig(null);
      setLoading(false);
      setLoadError(null);
      return;
    }
    const gen = ++genRef.current;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setConfig(null);
    void vaultService
      .getSettings(vaultId)
      .then((settings) => {
        if (cancelled || gen !== genRef.current) return;
        if (!settings) {
          setLoadError(new Error("missing settings"));
          return;
        }
        setConfig(settings);
      })
      .catch((error: unknown) => {
        if (cancelled || gen !== genRef.current) return;
        setLoadError(error);
      })
      .finally(() => {
        if (cancelled || gen !== genRef.current) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, vaultId, vaultService, loadAttempt]);

  const replaceConfig = useCallback((next: VaultSettingsConfig) => {
    setConfig(next);
  }, []);

  const invalidateLoad = useCallback(() => {
    genRef.current += 1;
    setLoading(false);
  }, []);

  const retryLoad = useCallback(() => {
    setLoadAttempt((n) => n + 1);
  }, []);

  return {
    config,
    loading,
    loadError,
    replaceConfig,
    invalidateLoad,
    retryLoad,
  };
}
