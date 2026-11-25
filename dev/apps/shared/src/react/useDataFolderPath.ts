import { useEffect, useState } from "react";
import type { VaultRootService } from "../services";

/**
 * The data folder in use, for the folder lists to name the folders their
 * fixed choices stand for. `null` while it is read, while `active` is off,
 * or when no data folder answers: the choices then show no folder.
 */
export function useDataFolderPath(service: VaultRootService, active = true): string | null {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    service.resolve().then(
      (resolved) => {
        if (!cancelled) setPath(resolved.status === "found" ? resolved.rootPath : null);
      },
      () => {
        if (!cancelled) setPath(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, service]);
  return path;
}
