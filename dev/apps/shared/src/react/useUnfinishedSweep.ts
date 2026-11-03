import { useEffect } from "react";
import type { VaultService } from "../services/vault/VaultService";

/**
 * Clear what a crash left from a job (the vault an import never finished, an
 * unfinished export file), once the data folder is ready and again for each
 * new one. A failure stays quiet: core keeps the record and logs it, and the
 * next launch tries again.
 */
export function useUnfinishedSweep(
  vaultService: Pick<VaultService, "sweepUnfinished">,
  ready: boolean,
  vaultRootEpoch: number,
): void {
  useEffect(() => {
    if (!ready) return;
    void vaultService.sweepUnfinished().catch(() => undefined);
  }, [ready, vaultRootEpoch, vaultService]);
}
