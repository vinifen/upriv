import * as SplashScreen from "expo-splash-screen";
import { BOOT_COVER_FADE_MS } from "@upriv/shared";

let visible = true;
const launchedAt = Date.now();

/** Milliseconds since the JS bundle started (the native splash was already up). */
export function msSinceLaunch(): number {
  return Date.now() - launchedAt;
}

/** Keep the native splash up past the first (empty) React frame. Call at module load. */
export function holdNativeSplash(): void {
  SplashScreen.setOptions({ duration: BOOT_COVER_FADE_MS, fade: true });
  void SplashScreen.preventAutoHideAsync().catch(() => undefined);
}

export function isNativeSplashVisible(): boolean {
  return visible;
}

/** Idempotent; the native side fades over `BOOT_COVER_FADE_MS`. */
export function hideNativeSplash(): void {
  if (!visible) return;
  visible = false;
  SplashScreen.hide();
}
