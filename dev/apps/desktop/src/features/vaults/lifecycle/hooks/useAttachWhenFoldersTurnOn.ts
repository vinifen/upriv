import { useEffect, useRef, type MutableRefObject } from "react";
import { storageModeIsPlaintext, type VaultListItem } from "@upriv/shared";

/**
 * The app's switch for encrypted vaults' unlocked folders turned on: every
 * open encrypted vault asks for its folder now, not at its next open (core
 * still decides for each vault). Turned off, a mounted folder stays until
 * its vault closes.
 */
export function useAttachWhenFoldersTurnOn(
  encryptedFoldersOn: boolean,
  vaults: MutableRefObject<readonly VaultListItem[]>,
  attach: (vaultId: string) => void,
): void {
  const wasOn = useRef(encryptedFoldersOn);
  useEffect(() => {
    const before = wasOn.current;
    wasOn.current = encryptedFoldersOn;
    if (before || !encryptedFoldersOn) return;
    for (const vault of vaults.current) {
      if (vault.session === "open" && !storageModeIsPlaintext(vault.storageMode)) {
        attach(vault.id);
      }
    }
  }, [attach, encryptedFoldersOn, vaults]);
}
