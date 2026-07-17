import { useCallback, useRef, useState, type DragEvent } from "react";
import { isOsFileDrag } from "@/features/vaults/file-manager/lib/osFileDrop";
import {
  absolutePathFromDroppedFile,
  dataTransferHasSevenZip,
  firstSevenZipFile,
} from "../lib/vaultArchiveDrop";

export interface VaultArchiveDropHandlers {
  /** True while an OS file drag is over the list and a `.7z` looks acceptable. */
  isArchiveDropActive: boolean;
  onDragEnter: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

/**
 * Accept OS `.7z` drops on the vault list when no blocking UI is open.
 *
 * FUTURE: copy the archive into the vault-root via daemon, probe password with
 * real 7zz, and replace mock `selectImportArchiveForProbe`. Non-`.7z` drops are
 * rejected now; multi-file drops use the first `.7z` only.
 */
export function useVaultArchiveDrop(options: {
  enabled: boolean;
  onAcceptSevenZip: (file: File, absolutePath?: string) => void;
  onRejectNonSevenZip?: () => void;
}): VaultArchiveDropHandlers {
  const { enabled, onAcceptSevenZip, onRejectNonSevenZip } = options;
  const [isArchiveDropActive, setIsArchiveDropActive] = useState(false);
  const depthRef = useRef(0);

  const reset = useCallback(() => {
    depthRef.current = 0;
    setIsArchiveDropActive(false);
  }, []);

  const onDragEnter = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depthRef.current += 1;
      // During dragenter, `files` is often empty; allow until drop inspects names.
      setIsArchiveDropActive(true);
    },
    [enabled],
  );

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const hasFilesListed = event.dataTransfer.files.length > 0;
      if (hasFilesListed && !dataTransferHasSevenZip(event.dataTransfer)) {
        event.dataTransfer.dropEffect = "none";
        setIsArchiveDropActive(false);
        return;
      }
      event.dataTransfer.dropEffect = "copy";
      setIsArchiveDropActive(true);
    },
    [enabled],
  );

  const onDragLeave = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setIsArchiveDropActive(false);
    },
    [enabled],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      reset();

      const archive = firstSevenZipFile(event.dataTransfer.files);
      if (!archive) {
        onRejectNonSevenZip?.();
        return;
      }
      onAcceptSevenZip(archive, absolutePathFromDroppedFile(archive));
    },
    [enabled, onAcceptSevenZip, onRejectNonSevenZip, reset],
  );

  return {
    isArchiveDropActive: enabled && isArchiveDropActive,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
