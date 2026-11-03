import { useSyncExternalStore } from "react";

/** One piece of work running or queued, as the quit overlay lists it. */
export interface RunningWorkItem {
  key: string;
  /** Already translated: the vault and what runs on it. */
  label: string;
  /** When core started it; `null` while queued, or when its start is not known. */
  startedAt: number | null;
  /** When Stop was asked for; `null` until then. */
  stoppingSince: number | null;
  /** False in the step it cannot stop. */
  stoppable: boolean;
  stop: () => void;
}

/** What runs now: the jobs, and how many vaults are closing. */
export interface RunningWork {
  items: readonly RunningWorkItem[];
  closing: number;
}

const IDLE: RunningWork = { items: [], closing: 0 };
let current: RunningWork = IDLE;
const listeners = new Set<() => void>();

/** The vault list publishes its work whenever it changes. */
export function publishRunningWork(next: RunningWork): void {
  current = next.items.length === 0 && next.closing === 0 ? IDLE : next;
  for (const notify of listeners) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(): RunningWork {
  return current;
}

/** What runs now, for the quit overlay and the work report to Electron main. */
export function useRunningWork(): RunningWork {
  return useSyncExternalStore(subscribe, read, read);
}
