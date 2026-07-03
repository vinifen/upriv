import { useMemo } from "react";
import { isDesktop } from "@/lib/desktop";

/** Whether the UI runs inside the Electron desktop shell (stable for the session). */
export function useIsDesktop(): boolean {
  return useMemo(() => isDesktop(), []);
}
