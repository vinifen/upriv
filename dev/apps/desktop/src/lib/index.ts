/** Public API for this package — re-export only symbols used outside `lib/`. */
export type { AppVersionInfo } from "./appVersion";
export {
  APP_VERSION,
  clearSessionAppVersion,
  getAppVersion,
  getSessionAppVersion,
} from "./appVersion";
