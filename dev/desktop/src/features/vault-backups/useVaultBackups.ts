import { useCallback, useEffect, useState } from "react";
import type { VaultBackupEntry } from "@upriv/shared";
import { useBackupService } from "@/platform/services";

export function useVaultBackups(vaultId: string | null, open: boolean) {
  const backupService = useBackupService();
  const [backups, setBackups] = useState<VaultBackupEntry[]>([]);

  const reload = useCallback(async () => {
    if (!vaultId) {
      setBackups([]);
      return;
    }
    setBackups(await backupService.listBackups(vaultId));
  }, [backupService, vaultId]);

  useEffect(() => {
    if (!open || !vaultId) return;
    void reload();
  }, [open, vaultId, reload]);

  const deleteBackups = useCallback(
    async (filenames: readonly string[]) => {
      if (!vaultId || filenames.length === 0) return;
      await backupService.deleteBackups(vaultId, filenames);
      await reload();
    },
    [backupService, reload, vaultId],
  );

  const promoteToSave = useCallback(
    async (filename: string) => {
      if (!vaultId) return;
      await backupService.promoteToSave(vaultId, filename);
      await reload();
    },
    [backupService, reload, vaultId],
  );

  return { backups, deleteBackups, promoteToSave, resetBackups: reload };
}
