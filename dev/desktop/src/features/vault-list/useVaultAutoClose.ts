import { useEffect, useRef } from "react";
import { resolveVaultDisplayStatus } from "@/types";
import { getMockVaultSettings } from "./mockVaultSettings";
import type { VaultListItem } from "./types";

interface UseVaultAutoCloseOptions {
  vaults: VaultListItem[];
  onWarn: (vault: VaultListItem, secondsLeft: number) => void;
  onAutoClose: (vault: VaultListItem) => void;
}

/** Idle auto-close timer per open vault (mock — uses `[auto_close]` from vault settings). */
export function useVaultAutoClose({ vaults, onWarn, onAutoClose }: UseVaultAutoCloseOptions) {
  const warnedRef = useRef<Map<string, number>>(new Map());
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
      warnedRef.current.clear();
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
    const tick = () => {
      const now = Date.now();
      const idleSeconds = (now - lastActivityRef.current) / 1000;

      for (const vault of vaults) {
        if (resolveVaultDisplayStatus(vault) !== "open") continue;

        const { auto_close: autoClose } = getMockVaultSettings(vault.id);
        if (!autoClose.enabled) continue;

        const limitSeconds = autoClose.idle_minutes * 60;
        const warnAt = Math.max(0, limitSeconds - autoClose.warn_before_seconds);
        const secondsLeft = Math.ceil(limitSeconds - idleSeconds);

        if (idleSeconds >= limitSeconds) {
          warnedRef.current.delete(vault.id);
          onAutoClose(vault);
          lastActivityRef.current = now;
          continue;
        }

        if (idleSeconds >= warnAt && secondsLeft > 0) {
          const lastWarned = warnedRef.current.get(vault.id);
          if (lastWarned !== secondsLeft) {
            warnedRef.current.set(vault.id, secondsLeft);
            onWarn(vault, secondsLeft);
          }
        }
      }
    };

    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [vaults, onWarn, onAutoClose]);
}
