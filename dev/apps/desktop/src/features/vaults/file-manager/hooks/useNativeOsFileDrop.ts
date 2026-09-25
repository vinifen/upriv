import { useEffect, useRef } from "react";
import { allowFileManagerDrop, beginOsFileImport, type OsDropSnapshot } from "../lib/osFileDrop";

/**
 * Capture OS drops while this file manager workspace is the open one.
 * Linux/Electron often delivers the drop on `html`/`body`, so this listens on
 * `document` and always calls `preventDefault` on dragover.
 */
export function useNativeOsFileDrop(options: {
  enabled?: boolean;
  getParentPath: () => string;
  isInternalDrag: () => boolean;
  importOsDrop: (
    parentPath: string,
    snapshot: OsDropSnapshot,
    opts?: { openFirstViewable?: boolean },
  ) => void | Promise<void>;
  onImported: () => void;
  onError: (error: unknown) => void;
}): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (options.enabled === false) return;

    const onDragOver = (event: DragEvent) => {
      allowFileManagerDrop(event, optionsRef.current.isInternalDrag() ? "move" : "copy");
    };

    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      if (!event.dataTransfer) return;
      const started = beginOsFileImport(
        event,
        optionsRef.current.getParentPath(),
        optionsRef.current.importOsDrop,
        optionsRef.current.onError,
        { openFirstViewable: true },
      );
      if (started) optionsRef.current.onImported();
    };

    document.addEventListener("dragenter", onDragOver, true);
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    return () => {
      document.removeEventListener("dragenter", onDragOver, true);
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
    };
  }, [options.enabled]);
}
