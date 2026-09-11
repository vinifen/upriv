import { useEffect, useRef } from "react";
import { shouldBumpVaultRootEpoch } from "../domain";

/**
 * Mid-session A/B (`vault_root_not_found` / `incomplete` / `alias_invalid`)
 * and SAF epoch codes: report to Gate and close the caller modal. Missing
 * `.upriv` resets to first-run Setup (defaults). Not `io_error`.
 */
export function useVaultRootIntegrityClose(
  open: boolean,
  failure: unknown,
  report: (error: unknown) => Promise<void>,
  onClose: () => void,
): void {
  const handled = useRef(false);

  useEffect(() => {
    if (!open) {
      handled.current = false;
      return;
    }
    if (failure == null) return;
    if (!shouldBumpVaultRootEpoch(failure)) return;
    if (handled.current) return;
    handled.current = true;
    void report(failure).then(() => {
      onClose();
    });
  }, [failure, onClose, open, report]);
}
