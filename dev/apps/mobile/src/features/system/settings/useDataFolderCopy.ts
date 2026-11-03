import { useCallback, useMemo, useRef, useState } from "react";
import { newJobId, type JobProgress } from "@upriv/shared";
import { useJobProgress } from "@upriv/shared/react";
import { useKeepAwakeWhile } from "@/hooks/useKeepAwakeWhile";
import { isAndroidSafUri } from "@/platform/native/pickVaultRootFolder";
import { useJobService } from "@/platform/services";

/** The copy a setup runs: its clock and its stop. */
export interface DataFolderCopy {
  /** When core was first seen copying. */
  startedAt: number;
  progress: JobProgress | null;
  /** When Stop was asked for; `null` until then. */
  stoppingSince: number | null;
}

/**
 * A setup on a picked storage-access folder may copy the phone's private data
 * folder into it, which takes as long as that folder is big. Core runs that
 * copy as a job with no time limit; once it is seen copying, the footer shows
 * Stop and the elapsed time in place of the button that started it. A setup
 * with nothing to copy never shows it and keeps the operation limit.
 */
export function useDataFolderCopy(onStopRefused: (error: unknown) => void) {
  const jobs = useJobService();
  const [running, setRunning] = useState<{ id: string; stoppingSince: number | null } | null>(null);
  const runningRef = useRef(running);
  const onStopRefusedRef = useRef(onStopRefused);
  onStopRefusedRef.current = onStopRefused;
  const track = useJobProgress(jobs, running?.id ?? null);
  useKeepAwakeWhile(running !== null, "upriv-data-folder-copy");

  const commit = useCallback((next: typeof running) => {
    runningRef.current = next;
    setRunning(next);
  }, []);

  /** The job a setup of `path` carries, or `undefined` when that setup copies nothing. */
  const begin = useCallback(
    (path: string): string | undefined => {
      if (!isAndroidSafUri(path)) return undefined;
      const id = newJobId();
      commit({ id, stoppingSince: null });
      return id;
    },
    [commit],
  );

  /** The setup that carried the job settled, whichever way. */
  const end = useCallback(() => commit(null), [commit]);

  const stop = useCallback(() => {
    const current = runningRef.current;
    if (!current || current.stoppingSince !== null) return;
    commit({ ...current, stoppingSince: Date.now() });
    void jobs.cancel(current.id, "user").catch((error: unknown) => {
      if (runningRef.current?.id !== current.id) return;
      commit({ ...current, stoppingSince: null });
      onStopRefusedRef.current(error);
    });
  }, [commit, jobs]);

  const copy = useMemo<DataFolderCopy | null>(
    () =>
      running && track.startedAt !== null
        ? {
            startedAt: track.startedAt,
            progress: track.progress,
            stoppingSince: running.stoppingSince,
          }
        : null,
    [running, track],
  );

  return { copy, begin, end, stop };
}
