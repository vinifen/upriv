import { useEffect, useRef } from "react";
import type { VaultService } from "../services/vault/VaultService";

/**
 * Clear what a crash left from a job (a vault whose create or store copy
 * never finished, an unfinished export file), once the data folder is ready
 * and again for each new one. `onRemovedVaults` gets the ids of the vaults it
 * deleted, so the list drops their rows and says why; a sweep that ends after
 * the screen moved on still reports, since its vaults are gone either way. A
 * failure stays quiet: core keeps the record and logs it, and the next launch
 * tries again.
 */
export function useUnfinishedSweep(
  vaultService: Pick<VaultService, "sweepUnfinished">,
  ready: boolean,
  vaultRootEpoch: number,
  onRemovedVaults: (vaultIds: string[]) => void,
): void {
  const onRemovedRef = useRef(onRemovedVaults);
  onRemovedRef.current = onRemovedVaults;
  useEffect(() => {
    if (!ready) return;
    void vaultService.sweepUnfinished().then(
      ({ removedVaults }) => {
        if (removedVaults.length > 0) onRemovedRef.current(removedVaults);
      },
      () => undefined,
    );
  }, [ready, vaultRootEpoch, vaultService]);
}
