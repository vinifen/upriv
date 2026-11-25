import { useEffect } from "react";
import type { VaultRow } from "../domain/vault/types";
import { scheduleInterval } from "./schedule";

/** How often the list is read again while a row's import runs that no pipeline here owns. */
export const IMPORTING_ROW_POLL_MS = 5_000;

/**
 * Read the list again while an import fills a row that this window does not
 * run (`session` `importing` with no create of it here: one a reload of the
 * window left running in core), so the row turns ready, or goes, when that
 * import ends. Nothing runs while no such row is listed.
 */
export function useRefreshWhileImporting(
  vaults: readonly VaultRow[],
  creatingVaultIds: readonly string[],
  reload: () => void,
): void {
  const waiting = vaults.some(
    (vault) => vault.session === "importing" && !creatingVaultIds.includes(vault.id),
  );
  useEffect(() => {
    if (!waiting) return;
    return scheduleInterval(reload, IMPORTING_ROW_POLL_MS);
  }, [reload, waiting]);
}
