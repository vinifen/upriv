import { useEffect, useRef } from "react";
import {
  type VaultSettingsConfig,
  resolveVaultDisplayStatus,
  type VaultListItem,
} from "@upriv/shared";
import { useVaultService } from "@/platform/services";

interface UseVaultAutoCloseOptions {
  vaults: VaultListItem[];
  isPipelineRunning: boolean;
  onWarn: (vault: VaultListItem, secondsLeft: number) => void;
  onAutoClose: (vault: VaultListItem) => void;
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
  onAutoClose,
}: UseVaultAutoCloseOptions) {
  const vaultService = useVaultService();
  const warnedRef = useRef<Set<string>>(new Set());
  const lastActivityRef = useRef(Date.now());
  const closedVaultIdsRef = useRef<Set<string>>(new Set());
  const settingsRef = useRef<Map<string, VaultSettingsConfig>>(new Map());

  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
      warnedRef.current.clear();
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

        const limitSeconds = autoClose.idle_minutes * 60;
        const warnAt = Math.max(0, limitSeconds - autoClose.warn_before_seconds);
        const secondsLeft = Math.ceil(limitSeconds - idleSeconds);

        if (idleSeconds >= limitSeconds) {
          if (isPipelineRunning || closedOne || closedVaultIdsRef.current.has(vault.id)) continue;
          warnedRef.current.delete(vault.id);
          closedVaultIdsRef.current.add(vault.id);
          onAutoClose(vault);
          closedOne = true;
          continue;
        }

        if (idleSeconds >= warnAt && secondsLeft > 0 && !warnedRef.current.has(vault.id)) {
          warnedRef.current.add(vault.id);
          onWarn(vault, secondsLeft);
        }
      }
    };

    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [vaults, isPipelineRunning, onWarn, onAutoClose]);
}
