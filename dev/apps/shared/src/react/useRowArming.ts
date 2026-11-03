import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { ROW_ARM_WINDOW_MS, rowPress } from "../domain";
import { scheduleTimeout } from "./schedule";

/** The one armed row button in the app, by its key. Arming another disarms it. */
let armed: { key: string; at: number } | null = null;
let cancelWindow: (() => void) | null = null;
const listeners = new Set<() => void>();

function setArmed(next: { key: string; at: number } | null): void {
  armed = next;
  cancelWindow?.();
  cancelWindow = next ? scheduleTimeout(() => setArmed(null), ROW_ARM_WINDOW_MS) : null;
  for (const notify of listeners) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function armedKey(): string | null {
  return armed?.key ?? null;
}

/**
 * Put the armed row button back to normal. True when one was armed, so a back
 * press it took goes no further. Platforms call it on a press elsewhere, a
 * scroll, Escape, Android back, and when the window loses focus.
 */
export function disarmRowButton(): boolean {
  if (armed === null) return false;
  setArmed(null);
  return true;
}

/** The key of the armed row button, or `null`. */
export function useArmedRowButton(): string | null {
  return useSyncExternalStore(subscribe, armedKey, armedKey);
}

/**
 * A row button that may ask for a second press (`rowPress`). `role` names
 * what the button does now (`stop`, `stop_final`, `unlock`, …): when it
 * changes the button disarms, and presses are ignored for `ROW_ROLE_GUARD_MS`.
 */
export function useRowArming(key: string, role: string, twoStep: boolean) {
  const current = useArmedRowButton();
  const roleRef = useRef(role);
  const roleChangedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (roleRef.current === role) return;
    roleRef.current = role;
    roleChangedAtRef.current = Date.now();
    if (armed?.key === key) setArmed(null);
  }, [key, role]);

  useEffect(
    () => () => {
      if (armed?.key === key) setArmed(null);
    },
    [key],
  );

  const press = useCallback(
    (action: () => void) => {
      const now = Date.now();
      const result = rowPress({
        now,
        twoStep,
        armedAt: armed?.key === key ? armed.at : null,
        roleChangedAt: roleChangedAtRef.current,
      });
      if (result === "arm") {
        setArmed({ key, at: now });
      } else if (result === "run") {
        if (armed?.key === key) setArmed(null);
        action();
      }
    },
    [key, twoStep],
  );

  return { armed: current === key, press };
}
