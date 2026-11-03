import { useEffect } from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

/**
 * Keep the phone from sleeping while `active`: long work runs on, and a
 * sleeping phone may pause it. Each caller holds its own `tag`, so one
 * releasing never wakes another's hold. No notification, no foreground
 * service; if Android stops the app anyway, the next launch cleans up.
 */
export function useKeepAwakeWhile(active: boolean, tag: string): void {
  useEffect(() => {
    if (!active) return;
    void activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => {
      void deactivateKeepAwake(tag).catch(() => undefined);
    };
  }, [active, tag]);
}
