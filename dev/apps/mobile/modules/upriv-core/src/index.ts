import { requireNativeModule } from "expo-modules-core";

/**
 * Native surface exposed by the Android Expo module (Kotlin).
 *
 * `appVersion` / `invoke` are the UniFFI-backed Rust bridge (same envelope as
 * the desktop daemon). The `saf*` methods are Kotlin-side helpers for the
 * Android Storage Access Framework. The data folder in use goes through
 * `mountSafRoot` (`SafFs.kt`): Rust sees `/upriv-saf-root` and the grant
 * holds the files. Every other picked folder is a tree (`mountTree`).
 */
export type UprivCoreNativeModule = {
  appVersion(): string;
  /**
   * Logical processors on this phone.
   * Hermes does not expose `navigator.hardwareConcurrency`.
   */
  processorCount(): number;
  /** UniFFI CORE RPC — runs off the JS thread (Expo `AsyncFunction`). */
  invoke(method: string, paramsJson: string): Promise<string>;
  /**
   * Same envelope as `invoke`, for read-only probes (`vault_close_phase`) that
   * must not queue behind a long `invoke`.
   */
  invokeProbe(method: string, paramsJson: string): Promise<string>;

  /** `takePersistableUriPermission(READ|WRITE)`. Idempotent — safe to call after picker. */
  safPersistPermission(treeUri: string): void;
  /**
   * Best-effort `releasePersistableUriPermission`. Missing perm is not an error.
   * The data folder in use, Default's Documents grant, and a mounted tree keep theirs.
   */
  safReleasePermission(treeUri: string): void;
  /**
   * The held grant Default's data folder lives in: Documents, or
   * Documents/Upriv. Empty until the person confirms Documents once.
   */
  safDocumentsGrant(): string;
  /**
   * Document URI for the shared Documents directory, used as the folder screen's start.
   */
  safDocumentsInitialUri(): string;
  /**
   * Mount Rust `/upriv-saf-root` on this persisted tree: the data folder the
   * list selects (a row, or Default's Documents grant). Throws
   * `saf_unreachable` when the tree's volume is gone while the grant is held.
   */
  mountSafRoot(treeUri: string): void;
  /** Drop that mount. */
  unmountSafRoot(): void;
  /**
   * Let Rust reach a tree the person picked (a row of a folder list, an
   * export's folder) at its own root, and return that root. Binds only: no
   * I/O, so a drive that is away fails on its first use.
   */
  mountTree(treeUri: string): string;
  /** Drop a tree's mount. Its grant stays until it is released. */
  unmountTree(treeUri: string): void;
  /** The trees Rust reaches now. */
  mountedTrees(): string[];
  /**
   * Before writing into a picked folder: throws `saf_unauthorized` when its
   * grant is gone, `saf_unreachable` when its volume does not answer.
   */
  checkTree(treeUri: string): void;
  /**
   * Open an existing OS path in the system Files app (Android).
   * Encrypted vaults have no OS folder — only a live mount / `upriv_plain` path.
   */
  revealInFileManager(osPath: string): void;
  /**
   * Stream one `content://` file into an open import session, as the job
   * `job` (`job_cancel` stops it).
   * Returns the UniFFI JSON envelope (`{ ok, result | error }`).
   */
  importContentUri(
    vaultId: string,
    logicalPath: string,
    contentUri: string,
    job: string,
  ): Promise<string>;
};

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

/** Logical processors, or 1 without the native module (Expo Go). */
export function nativeProcessorCount(): number {
  const count = getUprivCoreNative()?.processorCount();
  if (typeof count === "number" && Number.isFinite(count) && count >= 1) {
    return Math.floor(count);
  }
  return 1;
}
