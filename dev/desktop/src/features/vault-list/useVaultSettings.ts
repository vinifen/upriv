import { useCallback, useEffect, useState } from "react";
import { getMockVaultSettings } from "./mockVaultSettings";
import type { VaultSettingsConfig, VaultSettingsSectionId } from "./vaultSettingsTypes";

export function useVaultSettings(vaultId: string | null, open: boolean) {
  const [config, setConfig] = useState<VaultSettingsConfig | null>(null);

  useEffect(() => {
    if (!open || !vaultId) return;
    setConfig(getMockVaultSettings(vaultId));
  }, [open, vaultId]);

  const replaceConfig = useCallback((next: VaultSettingsConfig) => {
    setConfig(next);
  }, []);

  const patchSection = useCallback(
    <S extends VaultSettingsSectionId>(
      section: S,
      patch: Partial<VaultSettingsConfig[S]>,
    ) => {
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
    setConfig(getMockVaultSettings(vaultId));
  }, [vaultId]);

  return { config, replaceConfig, patchSection, resetConfig };
}
