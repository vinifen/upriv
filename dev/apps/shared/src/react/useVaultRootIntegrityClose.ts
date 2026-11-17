import { useEffect, useRef } from "react";
import { shouldBumpVaultRootEpoch } from "../domain";

/**
 * Mid-session A/B (`vault_root_not_found` / `incomplete` /
 * `data_folder_list_invalid`) and SAF epoch codes: report to Gate and close
 * the caller modal. A missing `.upriv` resets the in-memory preferences to
 * the defaults, and the Gate searches for a data folder that answers. Not
 * `io_error`.
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
