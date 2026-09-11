import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultBackupEntry } from "../domain";
import type { BackupService } from "../services";

export function useVaultBackups(
  backupService: BackupService,
  vaultId: string | null,
  open: boolean,
) {
  const [backups, setBackups] = useState<VaultBackupEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const requestIdRef = useRef(0);
  const busyGenRef = useRef(0);
  const backupsRef = useRef(backups);
  backupsRef.current = backups;
  const vaultIdRef = useRef(vaultId);
  vaultIdRef.current = vaultId;

  const invalidate = useCallback(() => {
    requestIdRef.current += 1;
  }, []);

  const reload = useCallback(async () => {
    if (!vaultId) {
      setBackups([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const list = await backupService.listBackups(vaultId);
      if (requestId !== requestIdRef.current) return;
      setBackups(list);
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
      setBackups([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    setBackups([]);
    setError(null);
    void reload().catch(() => undefined);
    return () => {
      invalidate();
      busyGenRef.current += 1;
    };
  }, [invalidate, open, reload, vaultId]);

  const deleteBackups = useCallback(
    async (stamps: readonly string[]) => {
      if (!vaultId || stamps.length === 0) return;
      const allowed = new Set(backupsRef.current.map((entry) => entry.stamp));
      if (stamps.some((stamp) => !allowed.has(stamp))) return;
      const startedFor = vaultId;
      const busyGen = ++busyGenRef.current;
      setIsBusy(true);
      setError(null);
      try {
        await backupService.deleteBackups(startedFor, stamps);
        if (busyGen !== busyGenRef.current) return;
        if (vaultIdRef.current !== startedFor) return;
        await reload();
      } catch (err) {
        if (busyGen !== busyGenRef.current) return;
        if (vaultIdRef.current !== startedFor) return;
        setError(err);
        throw err;
      } finally {
        if (busyGen === busyGenRef.current) setIsBusy(false);
      }
    },
    [backupService, reload, vaultId],
  );

  const promoteToSave = useCallback(
    async (stamp: string) => {
      if (!vaultId) return;
      const startedFor = vaultId;
      const busyGen = ++busyGenRef.current;
      setIsBusy(true);
      setError(null);
      try {
        await backupService.promoteToSave(startedFor, stamp);
        if (busyGen !== busyGenRef.current) return;
        if (vaultIdRef.current !== startedFor) return;
        await reload();
      } catch (err) {
        if (busyGen !== busyGenRef.current) return;
        if (vaultIdRef.current !== startedFor) return;
        setError(err);
        throw err;
      } finally {
        if (busyGen === busyGenRef.current) setIsBusy(false);
      }
    },
    [backupService, reload, vaultId],
  );

  return {
    backups,
    isLoading,
    isBusy,
    error,
    deleteBackups,
    promoteToSave,
    resetBackups: reload,
  };
}
