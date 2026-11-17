import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultBackupSection } from "../domain";
import type { BackupService } from "../services";

/** A vault's backups, one section per folder, and what the Backups window does with them. */
export function useVaultBackups(
  backupService: BackupService,
  vaultId: string | null,
  open: boolean,
  /** Bumped when a list-owned Back up now finishes, so an open modal reloads. */
  refreshToken = 0,
) {
  const [sections, setSections] = useState<VaultBackupSection[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const requestIdRef = useRef(0);
  const busyGenRef = useRef(0);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const vaultIdRef = useRef(vaultId);
  vaultIdRef.current = vaultId;

  const invalidate = useCallback(() => {
    requestIdRef.current += 1;
  }, []);

  const reload = useCallback(async () => {
    if (!vaultId) {
      setSections([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const listing = await backupService.listBackups(vaultId);
      if (requestId !== requestIdRef.current) return;
      setSections(listing.sections);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err);
      throw err;
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [backupService, vaultId]);

  // StrictMode remounts in development — `requestId` drops stale listBackups.
  useEffect(() => {
    busyGenRef.current += 1;
    setIsBusy(false);
    if (!open || !vaultId) {
      invalidate();
      setSections([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    setSections([]);
    setError(null);
    void reload().catch(() => undefined);
    return () => {
      invalidate();
      busyGenRef.current += 1;
    };
  }, [invalidate, open, reload, vaultId]);

  const appliedRefreshRef = useRef(refreshToken);
  useEffect(() => {
    if (appliedRefreshRef.current === refreshToken) return;
    appliedRefreshRef.current = refreshToken;
    if (!open || !vaultId) return;
    void reload().catch(() => undefined);
  }, [open, refreshToken, reload, vaultId]);

  /** Run one change for this vault, then read the list again. */
  const change = useCallback(
    async (work: (vaultId: string) => Promise<unknown>) => {
      if (!vaultId) return;
      const startedFor = vaultId;
      const busyGen = ++busyGenRef.current;
      setIsBusy(true);
      setError(null);
      try {
        await work(startedFor);
        if (busyGen !== busyGenRef.current || vaultIdRef.current !== startedFor) return;
        await reload();
      } catch (err) {
        if (busyGen !== busyGenRef.current || vaultIdRef.current !== startedFor) return;
        setError(err);
        throw err;
      } finally {
        if (busyGen === busyGenRef.current) setIsBusy(false);
      }
    },
    [reload, vaultId],
  );

  /** Keys the list shows: a change never names a backup the window did not list. */
  const listed = useCallback((keys: readonly string[]) => {
    const known = new Set(
      sectionsRef.current.flatMap((section) => section.entries.map((entry) => entry.key)),
    );
    return keys.length > 0 && keys.every((key) => known.has(key));
  }, []);

  const deleteBackups = useCallback(
    async (keys: readonly string[]) => {
      if (!listed(keys)) return;
      await change((id) => backupService.deleteBackups(id, keys));
    },
    [backupService, change, listed],
  );

  /** Promote standard backups to saves one by one, then read the list once. */
  const promoteToSave = useCallback(
    async (keys: readonly string[]) => {
      if (!listed(keys)) return;
      await change(async (id) => {
        for (const key of keys) await backupService.promoteToSave(id, key);
      });
    },
    [backupService, change, listed],
  );

  /** Name a backup, which pins it, or take its name away. */
  const renameBackup = useCallback(
    async (key: string, name: string) => {
      if (!listed([key])) return;
      await change((id) => backupService.renameBackup(id, key, name));
    },
    [backupService, change, listed],
  );

  /** Stop listing a folder that cannot be reached. Its files stay. */
  const forgetFolder = useCallback(
    async (folder: string) => {
      await change((id) => backupService.forgetFolder(id, folder));
    },
    [backupService, change],
  );

  return {
    sections,
    isLoading,
    isBusy,
    error,
    deleteBackups,
    promoteToSave,
    renameBackup,
    forgetFolder,
    resetBackups: reload,
  };
}
