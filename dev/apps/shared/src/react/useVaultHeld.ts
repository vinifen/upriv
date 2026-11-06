import { useCallback, useEffect, useMemo, useState } from "react";
import { heldSummary, type HeldItem, type HeldSummary } from "../domain";
import type { VaultFileSystemService } from "../services";

export interface VaultHeld {
  /** What the vault set aside; null when nothing is. */
  summary: HeldSummary | null;
  /** The review window is open. It closes by itself once nothing is set aside. */
  open: boolean;
  /** Open or close the review window. Opening it reads the list again. */
  show: (open: boolean) => void;
  /** Names a put back or a delete is working on. */
  working: ReadonlySet<string>;
  /** Put these files back. Resolves to where they are now; null once a failure was reported. */
  restore: (names: string[]) => Promise<string[] | null>;
  /** Delete these items for good. False once a failure was reported. */
  remove: (names: string[]) => Promise<boolean>;
}

interface HeldReport {
  /** The tree changed to `revision`, so the tree refetches. */
  mutated: (revision: number) => void;
  /** Ask core for the tree revision after a call that failed part way. */
  synced: () => Promise<void>;
  failed: (error: unknown) => void;
}

/**
 * Data one open vault set aside because no file of its tree names it. Only
 * the unlock that opened the session sets data aside, and only a put back or
 * a delete takes it away, so the list is read when the vault opens, when the
 * review window opens, and after each of those calls; not on every tree
 * change. Each call has the RPC limit, so `working` always clears. A list
 * that fails to load keeps what it showed: the rest of the file manager does
 * not depend on it.
 */
export function useVaultHeld(
  fs: Pick<VaultFileSystemService, "getHeld" | "restoreHeld" | "deleteHeld">,
  vaultId: string,
  report: HeldReport,
): VaultHeld {
  const [loaded, setLoaded] = useState<{ vaultId: string; items: HeldItem[] } | null>(null);
  const [reads, setReads] = useState(0);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<ReadonlySet<string>>(() => new Set());
  const { mutated, synced, failed } = report;

  useEffect(() => {
    let cancelled = false;
    fs.getHeld(vaultId).then(
      (items) => {
        if (!cancelled) setLoaded({ vaultId, items });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [fs, vaultId, reads]);

  const summary = useMemo(
    () => (loaded?.vaultId === vaultId ? heldSummary(loaded.items) : null),
    [loaded, vaultId],
  );

  useEffect(() => {
    if (!summary) setOpen(false);
  }, [summary]);

  const show = useCallback((next: boolean) => {
    setOpen(next);
    if (next) setReads((count) => count + 1);
  }, []);

  const run = useCallback(
    async <T>(names: string[], call: () => Promise<T & { revision: number }>) => {
      setWorking((prev) => new Set([...prev, ...names]));
      try {
        const done = await call();
        mutated(done.revision);
        return done;
      } catch (error) {
        failed(error);
        await synced().catch(() => undefined);
        return null;
      } finally {
        setWorking((prev) => new Set([...prev].filter((name) => !names.includes(name))));
        setReads((count) => count + 1);
      }
    },
    [failed, mutated, synced],
  );

  const restore = useCallback(
    async (names: string[]) =>
      (await run(names, () => fs.restoreHeld(vaultId, names)))?.paths ?? null,
    [fs, run, vaultId],
  );

  const remove = useCallback(
    async (names: string[]) =>
      (await run(names, async () => ({ revision: await fs.deleteHeld(vaultId, names) }))) !== null,
    [fs, run, vaultId],
  );

  return { summary, open: open && summary !== null, show, working, restore, remove };
}
