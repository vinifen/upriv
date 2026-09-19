import { requireNativeModule } from "expo-modules-core";

/**
 * Native surface exposed by the Android Expo module (Kotlin).
 *
 * `appVersion` / `invoke` are the UniFFI-backed Rust bridge (same envelope as
 * the desktop daemon). The `saf*` methods are Kotlin-side helpers for the
 * Android Storage Access Framework — used when the user picks a
 * `content://` folder that Rust `std::fs` cannot address (Documents, USB OTG,
 * external SD card, `Android/data/…`). See `SafVaultRoot.kt` and SDD §9.4.
 */
export type UprivCoreNativeModule = {
  appVersion(): string;
  /** UniFFI CORE RPC — runs off the JS thread (Expo `AsyncFunction`). */
  invoke(method: string, paramsJson: string): Promise<string>;

  /** `takePersistableUriPermission(READ|WRITE)`. Idempotent — safe to call after picker. */
  safPersistPermission(treeUri: string): void;
  /**
   * Best-effort `releasePersistableUriPermission`. Missing perm is not an error.
   * Native side refuses to drop the active vault-root tree.
   */
  safReleasePermission(treeUri: string): void;
  /**
   * Inspect `.upriv/settings.toml` under the SAF tree.
   * Returns `"absent"|"valid"|"incomplete"|"unauthorized"|"unreadable"` —
   * matches Rust `VaultRootDirStatus` plus `unauthorized` for revoked SAF perm.
   */
  safInspectRoot(treeUri: string): SafRootStatus;
  /**
   * Create the standard `.upriv/` layout at the SAF tree
   * (`settings.toml` + `vaults/`, `logs/`, `app/`, `runtime/`).
   * Pass `replacePolicy` `"delete"` | `"rename"` to replace an
   * incomplete marker; `null` is idempotent when settings already exist.
   * Pass `settingsTomlOverride` (from `app_settings_serialize_toml`) to seed
   * the marker atomically.
   */
  safSetupRoot(
    treeUri: string,
    locale: string | null,
    settingsTomlOverride: string | null,
    replacePolicy: string | null,
  ): void;
  /** Read `.upriv/settings.toml` body as UTF-8. Returns `null` when absent. */
  safReadSettings(treeUri: string): string | null;
  /** Overwrite `.upriv/settings.toml` (requires the folder to exist). */
  safWriteSettings(treeUri: string, contents: string): void;
  /** Currently active SAF tree URI (empty string when SAF mode is inactive). */
  safGetActiveUri(): string;
  /** Save the active SAF tree URI (empty string clears it). */
  safSetActiveUri(uri: string): void;
};

/**
 * Full set of Rust `VaultRootDirStatus` values plus SAF-specific
 * `"unauthorized"` (URI perm gone — treat as re-pick required).
 */
export type SafRootStatus = "absent" | "valid" | "incomplete" | "unauthorized" | "unreadable";

let cached: UprivCoreNativeModule | null | undefined;

/** Returns the native module when running in a dev-client / release build with `libupriv_ffi.so`. */
export function getUprivCoreNative(): UprivCoreNativeModule | null {
  if (cached !== undefined) return cached;
  try {
    cached = requireNativeModule<UprivCoreNativeModule>("UprivCore");
  } catch {
    cached = null;
  }
  return cached;
}

export function isNativeBridgeAvailable(): boolean {
  return getUprivCoreNative() !== null;
}
