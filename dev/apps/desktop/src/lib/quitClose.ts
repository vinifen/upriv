import { useSyncExternalStore } from "react";
import type { VaultCloseState } from "@upriv/shared";

/** Where one vault stands in the quit's close. */
export type QuitCloseStage = "waiting" | "flush" | "backup" | "closed";

/** One vault the quit closes, as its row and the quit window show it. */
export interface QuitCloseVault {
  vaultId: string;
  /** The vault's display name. */
  name: string;
  stage: QuitCloseStage;
  /** When its close was first seen running; `null` while it waits. */
  startedAt: number | null;
}

/**
 * The next stage of `vault` from what core answered. No answer keeps it as
 * it was; a close is never undone by a late `open`.
 */
export function nextQuitClose(
  vault: QuitCloseVault,
  answer: VaultCloseState | null,
  now: number,
): QuitCloseVault {
  if (answer === null || vault.stage === "closed") return vault;
  if (answer.state === "closed") return { ...vault, stage: "closed" };
  if (answer.state === "closing") {
    if (vault.stage === answer.phase) return vault;
    return { ...vault, stage: answer.phase, startedAt: vault.startedAt ?? now };
  }
  return vault;
}

const NONE: readonly QuitCloseVault[] = [];
let current: readonly QuitCloseVault[] = NONE;
const listeners = new Set<() => void>();

/** The vault list publishes the quit's close of every vault as it moves. */
export function publishQuitClose(next: readonly QuitCloseVault[]): void {
  current = next.length === 0 ? NONE : next;
  for (const notify of listeners) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(): readonly QuitCloseVault[] {
  return current;
}

/** The vaults the quit closes, for the quit window. Empty until a quit starts. */
export function useQuitClose(): readonly QuitCloseVault[] {
  return useSyncExternalStore(subscribe, read, read);
}
