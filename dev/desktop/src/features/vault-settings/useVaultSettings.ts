import { useCallback, useEffect, useState } from "react";
import { useVaultService } from "@/platform/services";
import type { VaultSettingsConfig, VaultSettingsSectionId } from "@upriv/shared";

export function useVaultSettings(vaultId: string | null, open: boolean) {
  const vaultService = useVaultService();
  const [config, setConfig] = useState<VaultSettingsConfig | null>(null);

  useEffect(() => {
    if (!open || !vaultId) return;
    let cancelled = false;
    void vaultService.getSettings(vaultId).then((settings) => {
      if (!cancelled) setConfig(settings ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, vaultId, vaultService]);

  const replaceConfig = useCallback((next: VaultSettingsConfig) => {
    setConfig(next);
  }, []);

  const patchSection = useCallback(
    <S extends VaultSettingsSectionId>(section: S, patch: Partial<VaultSettingsConfig[S]>) => {
      setConfig((current) =>
        current
          ? {
              ...current,
              [section]: { ...current[section], ...patch },
            }
          : current,
      );
    },
    [],
  );

  const resetConfig = useCallback(() => {
    if (!vaultId) return;
    void vaultService.getSettings(vaultId).then((settings) => {
      setConfig(settings ?? null);
    });
  }, [vaultId, vaultService]);

  return { config, replaceConfig, patchSection, resetConfig };
}
