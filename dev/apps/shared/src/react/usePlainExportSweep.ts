import { useEffect } from "react";
import type { VaultService } from "../services/vault/VaultService";

/**
 * Wipe the unfinished plain-text exports a crash left, once the data folder is
 * ready and again for each new one. A failure stays quiet: core keeps the record
 * and logs it, and the next launch tries again.
 */
export function usePlainExportSweep(
  vaultService: Pick<VaultService, "sweepPlainExports">,
  ready: boolean,
  vaultRootEpoch: number,
): void {
  useEffect(() => {
    if (!ready) return;
    void vaultService.sweepPlainExports().catch(() => undefined);
  }, [ready, vaultRootEpoch, vaultService]);
}
