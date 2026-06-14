import { useMemo } from "react";
import { isTauri as detectTauri } from "@/lib/tauri";

/** Whether the UI runs inside the Tauri WebView (stable for the session). */
export function useIsTauri(): boolean {
  return useMemo(() => detectTauri(), []);
}
