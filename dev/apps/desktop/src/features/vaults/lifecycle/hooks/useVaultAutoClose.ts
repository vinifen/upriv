import { useEffect, useRef } from "react";
import {
  canRunIdleAutoClose,
  resolveVaultDisplayStatus,
  type VaultListItem,
  type VaultSettingsConfig,
} from "@upriv/shared";
import { useVaultLifecycleService, useVaultService } from "@/platform/services";

interface UseVaultAutoCloseOptions {
  vaults: VaultListItem[];
  isPipelineRunning: boolean;
  onWarn: (vault: VaultListItem, secondsLeft: number) => void;
  onAutoCloseBlocked: (vault: VaultListItem) => void;
  onAutoClose: (vault: VaultListItem, settings: VaultSettingsConfig) => boolean;
}

/**
 * Idle auto-close per open vault (mock — uses `[auto_close]` from vault settings).
 *
 * App-level activity (PRD RF-35): any user input anywhere resets idle for every vault
 * with auto-close enabled. Each vault still tracks its own warn-once flag.
 */
export function useVaultAutoClose({
  vaults,
  isPipelineRunning,
  onWarn,
  onAutoCloseBlocked,
  onAutoClose,
}: UseVaultAutoCloseOptions) {
  const vaultService = useVaultService();
  const lifecycleService = useVaultLifecycleService();
  const warnedRef = useRef<Set<string>>(new Set());
  const blockedRef = useRef<Set<string>>(new Set());
  const lastActivityRef = useRef(Date.now());
  const closedVaultIdsRef = useRef<Set<string>>(new Set());
  const settingsRef = useRef<Map<string, VaultSettingsConfig>>(new Map());

  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
      warnedRef.current.clear();
      blockedRef.current.clear();
      closedVaultIdsRef.current.clear();
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll"] as const;
    for (const event of events) {
      window.addEventListener(event, bump, { passive: true });
    }
    return () => {
      for (const event of events) {
        window.removeEventListener(event, bump);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const openVaults = vaults.filter((vault) => resolveVaultDisplayStatus(vault) === "open");

    void (async () => {
      const next = new Map<string, VaultSettingsConfig>();
      for (const vault of openVaults) {
        const settings = await vaultService.getSettings(vault.id);
        if (settings) next.set(vault.id, settings);
      }
      if (!cancelled) settingsRef.current = next;
    })();

    return () => {
      cancelled = true;
    };
  }, [vaults, vaultService]);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const idleSeconds = (now - lastActivityRef.current) / 1000;
      let closedOne = false;

      for (const vault of vaults) {
        if (resolveVaultDisplayStatus(vault) !== "open") {
          closedVaultIdsRef.current.delete(vault.id);
          continue;
        }

        const settings = settingsRef.current.get(vault.id);
        if (!settings) continue;

        const autoClose = settings.auto_close;
        if (!autoClose.enabled) continue;

        const hasPasswordInRam = lifecycleService.hasPasswordInSession(vault.id);
        const canRun = canRunIdleAutoClose(
          vault,
          vault.storageMode,
          settings.security.mode,
          settings.close.default_action,
          hasPasswordInRam,
        );

        const limitSeconds = autoClose.idle_minutes * 60;
        const warnAt = Math.max(0, limitSeconds - autoClose.warn_before_seconds);
        const secondsLeft = Math.ceil(limitSeconds - idleSeconds);

        if (idleSeconds >= limitSeconds) {
          if (isPipelineRunning || closedOne || closedVaultIdsRef.current.has(vault.id)) continue;
          warnedRef.current.delete(vault.id);

          if (!canRun) {
            if (!blockedRef.current.has(vault.id)) {
              blockedRef.current.add(vault.id);
              onAutoCloseBlocked(vault);
            }
            continue;
          }

          const started = onAutoClose(vault, settings);
          if (started) {
            closedVaultIdsRef.current.add(vault.id);
            closedOne = true;
          }
          continue;
        }

        if (
          idleSeconds >= warnAt &&
          secondsLeft > 0 &&
          !warnedRef.current.has(vault.id)
        ) {
          warnedRef.current.add(vault.id);
          onWarn(vault, secondsLeft);
        }
      }
    };

    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [
    vaults,
    isPipelineRunning,
    lifecycleService,
    onAutoClose,
    onAutoCloseBlocked,
    onWarn,
  ]);
}
