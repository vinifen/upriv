import { useEffect } from "react";
import {
  canRunIdleAutoClose,
  resolveIdleAutoCloseIntent,
  resolveVaultDisplayStatus,
  type VaultListItem,
} from "@upriv/shared";
import { isTauri } from "@/lib/tauri/invoke";

interface UseSystemSuspendOptions {
  vaults: VaultListItem[];
  isPipelineRunning: boolean;
  getSettings: (vaultId: string) => Promise<import("@upriv/shared").VaultSettingsConfig | null | undefined>;
  hasPasswordInSession: (vaultId: string) => boolean;
  closeVaultForExit: (
    vault: VaultListItem,
    intent: "close" | "seal",
  ) => Promise<boolean>;
}

/** Unmount open vaults when the OS prepares for sleep and policy requires it. */
export function useSystemSuspend({
  vaults,
  isPipelineRunning,
  getSettings,
  hasPasswordInSession,
  closeVaultForExit,
}: UseSystemSuspendOptions) {
  useEffect(() => {
    if (!isTauri() || isPipelineRunning) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void import("@tauri-apps/api/event").then(({ listen }) => {
      if (disposed) return;
      void listen("system-suspend", () => {
        void (async () => {
          const openVaults = vaults.filter(
            (vault) => resolveVaultDisplayStatus(vault) === "open",
          );

          for (const vault of openVaults) {
            const settings = await getSettings(vault.id);
            if (!settings?.policy.require_unmount_on_sleep) continue;

            if (
              !canRunIdleAutoClose(
                vault,
                vault.storageMode,
                settings.security.mode,
                settings.close.default_action,
                hasPasswordInSession(vault.id),
              )
            ) {
              continue;
            }

            const intent = resolveIdleAutoCloseIntent(
              vault.storageMode,
              settings.close.default_action,
            );
            await closeVaultForExit(vault, intent);
          }
        })();
      }).then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      });
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    closeVaultForExit,
    getSettings,
    hasPasswordInSession,
    isPipelineRunning,
    vaults,
  ]);
}
