import type { IdleAutoCloseWarning, IdleLockResult, VaultListItem } from "@upriv/shared";
import { useIdleAutoClose, type IdleSessionEvent } from "@upriv/shared/react";
import { isElectronRenderer } from "@/lib/invoke";
import { useVaultService } from "@/platform/services";

interface UseVaultAutoCloseOptions {
  vaults: VaultListItem[];
  /** General setting. Off: sleep counts. On: only time Upriv is running counts. */
  keepOpenOnWake: boolean;
  onLock: (vaultId: string) => Promise<IdleLockResult>;
  onWarn: (warnings: readonly IdleAutoCloseWarning[]) => boolean;
}

/**
 * Closes each opted-in open vault from the device clock.
 * Activity is a click, key, or scroll inside Upriv — not focus, and not a
 * change in the mounted folder.
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
    subscribeSession: subscribeDesktopIdleSession,
    subscribeActivity: subscribeDesktopIdleActivity,
    onLock,
    onWarn,
  });
}

function subscribeDesktopIdleSession(onSession: (event: IdleSessionEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const stopPower = isElectronRenderer()
    ? window.upriv?.onEvent((name, payload) => {
        if (name !== "power") return;
        if (payload === "suspend") onSession("pause");
        else if (payload === "resume") onSession("resume");
      })
    : undefined;

  const onCheck = () => {
    if (document.visibilityState === "visible") onSession("check");
  };
  window.addEventListener("focus", onCheck);
  window.addEventListener("pageshow", onCheck);
  document.addEventListener("visibilitychange", onCheck);

  return () => {
    stopPower?.();
    window.removeEventListener("focus", onCheck);
    window.removeEventListener("pageshow", onCheck);
    document.removeEventListener("visibilitychange", onCheck);
  };
}

function subscribeDesktopIdleActivity(onActivity: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const events = ["pointerdown", "keydown", "scroll"] as const;
  for (const event of events) {
    window.addEventListener(event, onActivity, { passive: true, capture: true });
  }
  return () => {
    for (const event of events) {
      window.removeEventListener(event, onActivity, { capture: true });
    }
  };
}
