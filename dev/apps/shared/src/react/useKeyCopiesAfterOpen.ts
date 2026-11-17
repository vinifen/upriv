import { useCallback, useRef } from "react";
import { newJobId } from "../domain";
import type { VaultSecurityService } from "../services";

/**
 * The job after each open (`vault_key_copies_update`): core makes every
 * file's key copy the header's when one is behind, and answers at once when
 * nothing is due. It runs outside the open/close queue, as the unlocked
 * folder attach does; a close stops it and the next open resumes it, so it
 * never holds a close or a quit and reports nothing. Info shows where it
 * stands. One per vault at a time.
 */
export function useKeyCopiesAfterOpen(security: VaultSecurityService) {
  const runningRef = useRef(new Set<string>());
  return useCallback(
    (vaultId: string) => {
      if (runningRef.current.has(vaultId)) return;
      runningRef.current.add(vaultId);
      // A stop, a close, or a refusal leaves the key copies for the next open.
      void security
        .updateKeyCopies(vaultId, newJobId())
        .catch(() => undefined)
        .finally(() => runningRef.current.delete(vaultId));
    },
    [security],
  );
}
