import { useEffect, useRef, useState } from "react";
import type { StorageMode, UnlockedDestination } from "../domain";

/** Where an unlock would put a vault's files, as a window shows it. */
export interface UnlockedDestinationState {
  /** `null` while it is asked, or when the ask failed. */
  answer: UnlockedDestination | null;
  /** The lookup has not answered yet. */
  checking: boolean;
  /** The lookup failed: the window shows no folder line. */
  failed: boolean;
}

const IDLE: UnlockedDestinationState = { answer: null, checking: false, failed: false };

/**
 * `vault_unlocked_destination` for `vaultId` in `mode`, asked while
 * `enabled`. The window around it opens at once and the line fills in when
 * core answers, so a folder that is slow to answer never holds a field. The
 * call has its own time limit (`OPERATION_LIMIT_MS`).
 */
export function useUnlockedDestination(
  lookup: (vaultId: string, mode: StorageMode) => Promise<UnlockedDestination>,
  vaultId: string | null,
  mode: StorageMode,
  enabled: boolean,
): UnlockedDestinationState {
  const [state, setState] = useState<UnlockedDestinationState>(IDLE);
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

  useEffect(() => {
    if (!enabled || !vaultId) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    setState({ answer: null, checking: true, failed: false });
    lookupRef.current(vaultId, mode).then(
      (answer) => {
        if (!cancelled) setState({ answer, checking: false, failed: false });
      },
      () => {
        if (!cancelled) setState({ answer: null, checking: false, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, mode, vaultId]);

  return state;
}
