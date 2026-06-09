import { useCallback, useEffect, useState } from "react";
import { getMockBackupsForVault } from "./mockBackups";
import type { VaultBackupEntry } from "./backupTypes";

export function useVaultBackups(vaultId: string | null, open: boolean) {
  const [backups, setBackups] = useState<VaultBackupEntry[]>([]);

  useEffect(() => {
    if (!open || !vaultId) return;
    setBackups(getMockBackupsForVault(vaultId));
  }, [open, vaultId]);

  const deleteBackups = useCallback(
    (filenames: readonly string[]) => {
      if (!vaultId || filenames.length === 0) return;
      const remove = new Set(filenames);
      setBackups((current) => current.filter((entry) => !remove.has(entry.filename)));
    },
    [vaultId],
  );

  const promoteToSave = useCallback(
    (filename: string) => {
      if (!vaultId) return;
      setBackups((current) =>
        current.map((entry) =>
          entry.filename === filename && !entry.saved ? { ...entry, saved: true } : entry,
        ),
      );
    },
    [vaultId],
  );

  const resetBackups = useCallback(() => {
    if (!vaultId) return;
    setBackups(getMockBackupsForVault(vaultId));
  }, [vaultId]);

  return { backups, deleteBackups, promoteToSave, resetBackups };
}
