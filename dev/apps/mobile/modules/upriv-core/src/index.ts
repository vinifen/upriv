import { requireNativeModule } from "expo-modules-core";

/**
 * Native surface exposed by the Android Expo module (Kotlin).
 *
 * `appVersion` / `invoke` are the UniFFI-backed Rust bridge (same envelope as
 * the desktop daemon). The `saf*` methods are Kotlin-side helpers for the
 * Android Storage Access Framework — used when the user picks a
 * `content://` folder. Vault bytes for that folder go through `mountSafRoot`
 * (`SafFs.kt`): Rust sees `/upriv-saf-root` and the grant holds the files.
 */
export type UprivCoreNativeModule = {
  appVersion(): string;
  /**
   * Logical processors on this phone. Optional: older native builds omit it.
   * Hermes does not expose `navigator.hardwareConcurrency`.
   */
  processorCount?(): number;
  /** UniFFI CORE RPC — runs off the JS thread (Expo `AsyncFunction`). */
  invoke(method: string, paramsJson: string): Promise<string>;
  /**
   * Same envelope as `invoke`, for read-only probes (`vault_close_phase`) that
   * must not queue behind a long `invoke`. Optional: older native builds omit it.
   */
  invokeProbe?(method: string, paramsJson: string): Promise<string>;

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
  /**
   * Document URI for the shared Documents directory, used as the folder screen's start.
   * Optional: Expo Go and older native builds omit this method.
   */
  safDocumentsInitialUri?(): string;
  /**
   * Mount Rust `/upriv-saf-root` on this persisted tree so vault create and
   * edit write there. Optional on older binaries.
   */
  mountSafRoot?(treeUri: string): void;
  /** Drop that mount. Optional on older binaries. */
  unmountSafRoot?(): void;
  /**
   * Open an existing OS path in the system Files app (Android).
   * Encrypted vaults have no OS folder — only a live mount / `upriv_plain` path.
   * Optional: Expo Go and older native builds omit this method.
   */
  revealInFileManager?(osPath: string): void;
  /**
   * Stream one `content://` file into an open import session.
   * Returns the UniFFI JSON envelope (`{ ok, result | error }`).
   * Optional: Expo Go and builds from before this method omit it.
   */
  importContentUri?(vaultId: string, logicalPath: string, contentUri: string): Promise<string>;
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

/** Logical processors, or 1 when the native module does not report them. */
export function nativeProcessorCount(): number {
  const count = getUprivCoreNative()?.processorCount?.();
  if (typeof count === "number" && Number.isFinite(count) && count >= 1) {
    return Math.floor(count);
  }
  return 1;
}
