import { useCallback, useRef, useState, type DragEvent } from "react";
import { isOsFileDrag } from "@/features/vaults/file-manager/lib/osFileDrop";
import {
  absolutePathFromDroppedFile,
  dataTransferHasVaultImport,
  firstVaultImportFile,
} from "../lib/vaultImportDrop";

export interface VaultImportDropHandlers {
  /** True while an OS file drag is over the list and a `.zip` / `.7z` looks acceptable. */
  isImportDropActive: boolean;
  onDragEnter: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

/**
 * Accept OS `.zip` / `.7z` drops on the vault list when no blocking UI is open.
 *
 * Electron 32+ exposes the real path via `window.upriv.getPathForFile`.
 * Multi-file drops use the first matching name only.
 */
export function useVaultImportDrop(options: {
  enabled: boolean;
  onAcceptImportPackage: (file: File, absolutePath?: string) => void;
  onRejectNonImport?: () => void;
}): VaultImportDropHandlers {
  const { enabled, onAcceptImportPackage, onRejectNonImport } = options;
  const [isImportDropActive, setIsImportDropActive] = useState(false);
  const depthRef = useRef(0);

  const reset = useCallback(() => {
    depthRef.current = 0;
    setIsImportDropActive(false);
  }, []);

  const onDragEnter = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depthRef.current += 1;
      // During dragenter, `files` is often empty; allow until drop inspects names.
      setIsImportDropActive(true);
    },
    [enabled],
  );

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const hasFilesListed = event.dataTransfer.files.length > 0;
      if (hasFilesListed && !dataTransferHasVaultImport(event.dataTransfer)) {
        event.dataTransfer.dropEffect = "none";
        setIsImportDropActive(false);
        return;
      }
      event.dataTransfer.dropEffect = "copy";
      setIsImportDropActive(true);
    },
    [enabled],
  );

  const onDragLeave = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setIsImportDropActive(false);
    },
    [enabled],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      reset();

      const archive = firstVaultImportFile(event.dataTransfer.files);
      if (!archive) {
        onRejectNonImport?.();
        return;
      }
      onAcceptImportPackage(archive, absolutePathFromDroppedFile(archive));
    },
    [enabled, onAcceptImportPackage, onRejectNonImport, reset],
  );

  return {
    isImportDropActive: enabled && isImportDropActive,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
