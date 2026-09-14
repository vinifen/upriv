import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { remainingClosingDisplayMs } from "../domain/vault-lifecycle/closingDisplay";
import { scheduleTimeout } from "./schedule";

/**
 * Keep a vault on the Closing badge for at least `MIN_CLOSING_DISPLAY_MS`
 * without holding the FIFO pipeline. Cancel if the user unlocks again.
 */
export function useClosingDisplayHold() {
  const [holdIds, setHoldIds] = useState<string[]>([]);
  const startedAtRef = useRef(new Map<string, number>());
  const cancelTimerRef = useRef(new Map<string, () => void>());

  const removeHold = useCallback((vaultId: string) => {
    setHoldIds((current) =>
      current.includes(vaultId) ? current.filter((id) => id !== vaultId) : current,
    );
  }, []);

  const cancel = useCallback(
    (vaultId: string) => {
      cancelTimerRef.current.get(vaultId)?.();
      cancelTimerRef.current.delete(vaultId);
      startedAtRef.current.delete(vaultId);
      removeHold(vaultId);
    },
    [removeHold],
  );

  const begin = useCallback((vaultId: string) => {
    cancelTimerRef.current.get(vaultId)?.();
    cancelTimerRef.current.delete(vaultId);
    startedAtRef.current.set(vaultId, Date.now());
    setHoldIds((current) => (current.includes(vaultId) ? current : [...current, vaultId]));
  }, []);

  const settle = useCallback(
    (vaultId: string, onReveal: () => void) => {
      const startedAt = startedAtRef.current.get(vaultId) ?? Date.now();
      const remain = remainingClosingDisplayMs(startedAt);
      const reveal = () => {
        cancelTimerRef.current.delete(vaultId);
        startedAtRef.current.delete(vaultId);
        removeHold(vaultId);
        onReveal();
      };
      if (remain <= 0) {
        reveal();
        return;
      }
      cancelTimerRef.current.get(vaultId)?.();
      cancelTimerRef.current.set(vaultId, scheduleTimeout(reveal, remain));
    },
    [removeHold],
  );

  useEffect(
    () => () => {
      for (const stop of cancelTimerRef.current.values()) stop();
      cancelTimerRef.current.clear();
    },
    [],
  );

  return useMemo(() => ({ holdIds, begin, cancel, settle }), [begin, cancel, holdIds, settle]);
}
