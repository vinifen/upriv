import Constants from "expo-constants";
import type { AppDistribution } from "@upriv/shared";
import { getUprivCoreNative } from "upriv-core";

export interface MobileAppVersionInfo {
  version: string;
  distribution: AppDistribution;
  offline: boolean;
}

function packageVersion(): string {
  return Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "0.1.0-beta";
}

/** Prefer native FFI version; fall back to Expo app version. */
export function getMobileAppVersion(): MobileAppVersionInfo {
  // Android mobile is always "installed" by contract (no portable distribution mode).
  const native = getUprivCoreNative();
  if (!native) {
    return {
      version: packageVersion(),
      distribution: "installed",
      offline: true,
    };
  }
  try {
    const version = native.appVersion()?.trim();
    return {
      version: version || packageVersion(),
      distribution: "installed",
      offline: false,
    };
  } catch {
    return {
      version: packageVersion(),
      distribution: "installed",
      offline: true,
    };
  }
}
