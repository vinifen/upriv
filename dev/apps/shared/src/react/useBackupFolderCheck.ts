import { useCallback, useEffect, useRef, useState } from "react";
import { VAULT_ROOT_PATH_CHECK_DELAY_MS, type BackupFolderStatus } from "../domain";
import type { BackupService } from "../services";
import { scheduleTimeout } from "./schedule";

export interface BackupFolderCheck {
  /** Null while the folder is not in use, or the check has not answered. */
  status: BackupFolderStatus | null;
  /** The check is running, from the first key typed. */
  checking: boolean;
  retry: () => void;
}

/**
 * Ask core what the folder at `path` can do right now, after the typing stops.
 * An empty `path` is no folder to check. A folder that does not answer costs
 * a few seconds at most, and a late answer for an earlier path is dropped.
 */
export function useBackupFolderCheck(
  service: BackupService,
  path: string,
  vaultId: string | null,
): BackupFolderCheck {
  const trimmed = path.trim();
  const [status, setStatus] = useState<BackupFolderStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    setStatus(null);
    if (!trimmed) {
      setChecking(false);
      return;
    }
    setChecking(true);
    const cancel = scheduleTimeout(() => {
      void service
        .checkFolder(trimmed, vaultId)
        .catch((): BackupFolderStatus => "other")
        .then((answer) => {
          if (request !== latest.current) return;
          setStatus(answer);
          setChecking(false);
        });
    }, VAULT_ROOT_PATH_CHECK_DELAY_MS);
    return () => {
      cancel();
      latest.current += 1;
    };
  }, [attempt, service, trimmed, vaultId]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  return { status, checking, retry };
}
