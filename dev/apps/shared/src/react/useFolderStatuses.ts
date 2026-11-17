import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FOLDER_PATH_CHECK_DELAY_MS } from "../domain";
import { scheduleTimeout } from "./schedule";

/** A check that could not run. */
const FAILED = Symbol("failed");

/**
 * The status of each folder of a list, checked on its own: one row's slow
 * drive never holds up another, and a row's line shows as soon as its check
 * answers. A typed path is checked once it settles
 * (`FOLDER_PATH_CHECK_DELAY_MS`), and reads `null` (checking) from the first
 * key until its answer. A path that leaves the list forgets its answer, so
 * typed again it is checked again. A path whose check could not run is left
 * out of the map: it has no status until `retry`, which checks every path
 * again.
 */
export function useFolderStatuses<S>(
  paths: readonly string[],
  check: (path: string) => Promise<S>,
  enabled = true,
): { statuses: ReadonlyMap<string, S | null>; retry: () => void } {
  const [answers, setAnswers] = useState<ReadonlyMap<string, S | typeof FAILED>>(new Map());
  const [round, setRound] = useState(0);
  const checkRef = useRef(check);
  checkRef.current = check;
  /** Each asked path's latest ask: only its answer counts. */
  const asks = useRef(new Map<string, number>());
  const lastAsk = useRef(0);
  const key = paths.map((path) => path.trim()).join("\0");
  const wanted = useMemo(
    () => [...new Set(key.split("\0").filter((path) => path.length > 0))],
    [key],
  );

  useEffect(() => {
    // A path no longer in the list forgets its ask and its answer.
    for (const path of [...asks.current.keys()]) {
      if (!wanted.includes(path)) asks.current.delete(path);
    }
    setAnswers((previous) => {
      const gone = [...previous.keys()].filter((path) => !wanted.includes(path));
      if (gone.length === 0) return previous;
      const next = new Map(previous);
      for (const path of gone) next.delete(path);
      return next;
    });
    if (!enabled) return;
    return scheduleTimeout(() => {
      for (const path of wanted) {
        if (asks.current.has(path)) continue;
        const ask = ++lastAsk.current;
        asks.current.set(path, ask);
        const settle = (answer: S | typeof FAILED) => {
          if (asks.current.get(path) !== ask) return;
          setAnswers((previous) => new Map(previous).set(path, answer));
        };
        void checkRef.current(path).then(settle, () => settle(FAILED));
      }
    }, FOLDER_PATH_CHECK_DELAY_MS);
  }, [enabled, wanted, round]);

  const retry = useCallback(() => {
    asks.current.clear();
    setAnswers(new Map());
    setRound((value) => value + 1);
  }, []);

  const statuses = useMemo(() => {
    const shown = new Map<string, S | null>();
    for (const path of wanted) {
      const answer = answers.get(path);
      if (answer !== FAILED) shown.set(path, answer ?? null);
    }
    return shown;
  }, [answers, wanted]);

  return { statuses, retry };
}
