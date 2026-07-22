import type { AppDistribution } from "@upriv/shared";
import { rpcAppVersion } from "./rpc";
import { isDesktop } from "./invoke";

/** Product version from `dev/VERSION` (injected by Vite as `__UPRIV_APP_VERSION__`). */
export const APP_VERSION = __UPRIV_APP_VERSION__;

export interface AppVersionInfo {
  version: string;
  /** Packaging mode from daemon when available. */
  distribution?: AppDistribution;
  /** `daemon` when upriv-daemon responded; `version-file` when using VERSION fallback. */
  source: "daemon" | "version-file";
  /** True when the VERSION-file fallback was used because the daemon was unreachable. */
  offline?: boolean;
}

let sessionVersion: AppVersionInfo | null = null;

/** Last successful version fetch this app session (Electron). */
export function getSessionAppVersion(): AppVersionInfo | null {
  return sessionVersion;
}

/** Clear cached daemon version (e.g. after backend exit / reconnect). */
export function clearSessionAppVersion(): void {
  sessionVersion = null;
}

/** Shell version from upriv-daemon when in Electron; otherwise `dev/VERSION`. */
export async function getAppVersion(): Promise<AppVersionInfo> {
  if (!isDesktop()) {
    return { version: APP_VERSION, source: "version-file" };
  }
  if (sessionVersion?.source === "daemon") {
    return sessionVersion;
  }
  try {
    const { version, distribution } = await rpcAppVersion();
    sessionVersion = { version, distribution, source: "daemon" };
    return sessionVersion;
  } catch (error) {
    // Do not cache the failure: a later call retries the daemon this session.
    console.warn("[upriv] getAppVersion: daemon unavailable", error);
    return {
      version: APP_VERSION,
      source: "version-file",
      offline: true,
    };
  }
}
