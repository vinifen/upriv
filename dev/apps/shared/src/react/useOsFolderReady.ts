import { useCallback, useEffect, useRef, useState } from "react";
import type { OsFolderAnswer } from "../domain";
import { scheduleTimeout } from "./schedule";

/** How often a folder that is still attaching is asked again. */
const OS_FOLDER_RECHECK_MS = 1_000;

/**
 * Whether an open vault's unlocked folder is in the OS now
 * (`vault_fs_os_path` answers `ready`). Open unlocked folder, Show in unlocked
 * folder, and Open in terminal show only then: a vault with no folder (its
 * switch off, none chosen, a phone) offers none of them, and says nothing.
 * Asked while `enabled`, again each second while the folder attaches, and on
 * `recheck` (a menu that opens). `lost` hides them after a mount stops
 * answering, until the next ask.
 */
export function useOsFolderReady(
  osPath: (vaultId: string, path: string) => Promise<OsFolderAnswer>,
  vaultId: string,
  enabled: boolean,
): { ready: boolean; recheck: () => void; lost: () => void } {
  const [ready, setReady] = useState(false);
  const [round, setRound] = useState(0);
  const osPathRef = useRef(osPath);
  osPathRef.current = osPath;

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    let cancelled = false;
    let cancelRetry = () => {};
    const ask = () => {
      osPathRef.current(vaultId, "/").then(
        (answer) => {
          if (cancelled) return;
          setReady(answer.state === "ready");
          if (answer.state === "attaching")
            cancelRetry = scheduleTimeout(ask, OS_FOLDER_RECHECK_MS);
        },
        () => {
          if (!cancelled) setReady(false);
        },
      );
    };
    ask();
    return () => {
      cancelled = true;
      cancelRetry();
    };
  }, [enabled, round, vaultId]);

  const recheck = useCallback(() => setRound((value) => value + 1), []);
  const lost = useCallback(() => setReady(false), []);
  return { ready, recheck, lost };
}
