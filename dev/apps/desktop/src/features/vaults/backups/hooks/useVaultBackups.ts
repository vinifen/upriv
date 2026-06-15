import { useCallback, useEffect, useState } from "react";
import type { VaultBackupEntry } from "@upriv/shared";
import { useBackupService } from "@/platform/services";

export function useVaultBackups(vaultId: string | null, open: boolean) {
  const backupService = useBackupService();
  const [backups, setBackups] = useState<VaultBackupEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    if (!vaultId) {
      setBackups([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setBackups(await backupService.listBackups(vaultId));
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [backupService, vaultId]);

  useEffect(() => {
    if (!open || !vaultId) return;
    void reload().catch(() => undefined);
  }, [open, vaultId, reload]);

  const deleteBackups = useCallback(
    async (filenames: readonly string[]) => {
      if (!vaultId || filenames.length === 0) return;
      setIsBusy(true);
      setError(null);
      try {
        await backupService.deleteBackups(vaultId, filenames);
        await reload();
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setIsBusy(false);
      }
    },
    [backupService, reload, vaultId],
  );

  const promoteToSave = useCallback(
    async (filename: string) => {
      if (!vaultId) return;
      setIsBusy(true);
      setError(null);
      try {
        await backupService.promoteToSave(vaultId, filename);
        await reload();
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setIsBusy(false);
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
