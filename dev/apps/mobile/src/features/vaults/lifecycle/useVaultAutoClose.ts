import { AppState } from "react-native";
import type { IdleAutoCloseWarning, IdleLockResult, VaultListItem } from "@upriv/shared";
import { useIdleAutoClose, type IdleSessionEvent } from "@upriv/shared/react";
import { subscribeIdleActivity } from "@/lib/idleActivity";
import { useVaultService } from "@/platform/services";

interface UseVaultAutoCloseOptions {
  vaults: VaultListItem[];
  /** General setting. Off: time the phone froze Upriv counts. On: it does not. */
  keepOpenOnWake: boolean;
  onLock: (vaultId: string) => Promise<IdleLockResult>;
  onWarn: (warnings: readonly IdleAutoCloseWarning[]) => boolean;
}

/**
 * Closes each opted-in open vault from the device clock.
 * Leaving the app is a pause (the OS freezes Upriv). Coming back is not activity.
 */
export function useVaultAutoClose({
  vaults,
  keepOpenOnWake,
  onLock,
  onWarn,
}: UseVaultAutoCloseOptions) {
  const vaultService = useVaultService();
  return useIdleAutoClose({
    vaults,
    keepOpenOnWake,
    loadAutoClose: async (vaultId) => {
      const settings = await vaultService.getSettings(vaultId);
      return settings?.auto_close ?? null;
    },
    subscribeSession: subscribeMobileIdleSession,
    subscribeActivity: subscribeIdleActivity,
    onLock,
    onWarn,
  });
}

function subscribeMobileIdleSession(onSession: (event: IdleSessionEvent) => void): () => void {
  const sub = AppState.addEventListener("change", (next) => {
    onSession(next === "active" ? "resume" : "pause");
  });
  return () => sub.remove();
}
