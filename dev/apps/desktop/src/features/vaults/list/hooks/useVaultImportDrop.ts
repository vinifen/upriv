import { useCallback, useRef, useState, type DragEvent } from "react";
import {
  isPotentialOsFileDrag,
  snapshotLooksLikeOsImport,
  snapshotOsFileDrop,
} from "@/features/vaults/file-manager/lib/osFileDrop";
import { vaultListDropSource, type VaultListDropSource } from "../lib/vaultImportDrop";

export interface VaultImportDropHandlers {
  /** True while an OS file or folder drag is over the list. */
  isImportDropActive: boolean;
  onDragEnter: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

/**
 * Accept an OS file or folder drop on the vault list when no blocking UI is open.
 * Same sources as create-vault Import: any file, or one folder.
 *
 * The path comes from the same OS drop snapshot as the file manager (File path,
 * `text/uri-list`, Nautilus, XDG portal). A drop of several items uses the first
 * root only. A folder's children are that one folder.
 */
export function useVaultImportDrop(options: {
  enabled: boolean;
  onAcceptImportPackage: (source: VaultListDropSource) => void;
}): VaultImportDropHandlers {
  const { enabled, onAcceptImportPackage } = options;
  const [isImportDropActive, setIsImportDropActive] = useState(false);
  const depthRef = useRef(0);
  const dropGenRef = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const reset = useCallback(() => {
    depthRef.current = 0;
    setIsImportDropActive(false);
  }, []);

  const onDragEnter = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isPotentialOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depthRef.current += 1;
      setIsImportDropActive(true);
    },
    [enabled],
  );

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isPotentialOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setIsImportDropActive(true);
    },
    [enabled],
  );

  const onDragLeave = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isPotentialOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setIsImportDropActive(false);
    },
    [enabled],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!enabled || !isPotentialOsFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      reset();

      const snapshot = snapshotOsFileDrop(event, { pathsOnly: true });
      if (!snapshotLooksLikeOsImport(snapshot)) return;
      const generation = dropGenRef.current + 1;
      dropGenRef.current = generation;
      void vaultListDropSource(snapshot).then((source) => {
        if (dropGenRef.current !== generation || !enabledRef.current || !source) return;
        onAcceptImportPackage(source);
      });
    },
    [enabled, onAcceptImportPackage, reset],
  );

  return {
    isImportDropActive: enabled && isImportDropActive,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}
