import { useEffect, useRef } from "react";
import {
  canRunIdleAutoClose,
  resolveIdleAutoCloseIntent,
  resolveVaultDisplayStatus,
  type VaultListItem,
  type VaultSettingsConfig,
} from "@upriv/shared";
import { registerAppExitHandler } from "@/app/appExitBridge";

interface UseAppExitCloseOptions {
  vaults: VaultListItem[];
  isPipelineRunning: boolean;
  getSettings: (vaultId: string) => Promise<VaultSettingsConfig | null | undefined>;
  hasPasswordInSession: (vaultId: string) => boolean;
  closeVaultForExit: (
    vault: VaultListItem,
    intent: "close" | "seal",
  ) => Promise<boolean>;
}

/** Start vault close/seal pipelines on app quit (best-effort; quit is not blocked). */
export function useAppExitClose({
  vaults,
  isPipelineRunning,
  getSettings,
  hasPasswordInSession,
  closeVaultForExit,
}: UseAppExitCloseOptions) {
  const busyRef = useRef(isPipelineRunning);
  busyRef.current = isPipelineRunning;
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;

  useEffect(() => {
    const runExitVaultClose = () => {
      if (busyRef.current) return;

      const openVaults = vaultsRef.current.filter(
        (vault) => resolveVaultDisplayStatus(vault) === "open",
      );

      for (const vault of openVaults) {
        void (async () => {
          try {
            const settings = await getSettings(vault.id);
            if (!settings?.auto_close.close_on_app_exit) return;

            if (
              !canRunIdleAutoClose(
                vault,
                vault.storageMode,
                settings.security.mode,
                settings.close.default_action,
                hasPasswordInSession(vault.id),
              )
            ) {
              return;
            }

            const intent = resolveIdleAutoCloseIntent(
              vault.storageMode,
              settings.close.default_action,
            );
            await closeVaultForExit(vault, intent);
          } catch (error) {
            console.error("exit-close failed for vault", vault.id, error);
          }
        })();
      }
    };

    registerAppExitHandler(runExitVaultClose);
    return () => registerAppExitHandler(null);
  }, [closeVaultForExit, getSettings, hasPasswordInSession]);
}
