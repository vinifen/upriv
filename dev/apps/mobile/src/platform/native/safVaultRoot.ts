import { RpcError } from "@upriv/shared";
import { getUprivCoreNative, type SafRootStatus, type UprivCoreNativeModule } from "upriv-core";

/**
 * SAF (Android Storage Access Framework) surface used by mobile services.
 *
 * Rust `upriv-core` speaks `std::fs::Path` and cannot address `content://`
 * URIs from the Android system picker. This module owns the SAF side of the
 * `.upriv/` tree — inspect / setup / read / write of `settings.toml` — so the
 * mobile UI can host a custom vault-root on Documents / USB OTG / SD card
 * volumes without a full `VaultStorage` trait migration in Rust.
 *
 * Layering:
 * - Kotlin (`SafVaultRoot.kt`): DocumentsContract I/O + persistable perm
 * - Rust (`app_settings_parse_toml` / `app_settings_serialize_toml`): TOML shape
 * - TS (this file): glue + narrow error boundary
 *
 * See SDD §9.4, ARCHITECTURE §6.
 */

/** `content://` scheme check — matches `pickVaultRootFolder.isAndroidSafUri`. */
export function isSafTreeUri(candidate: string): boolean {
  return candidate.trim().startsWith("content://");
}

function requireNative(): UprivCoreNativeModule {
  const native = getUprivCoreNative();
  if (!native) {
    throw new RpcError("bridge_invoke_failed", "UprivCore native module not loaded");
  }
  return native;
}

function collectErrorBlobs(error: unknown, into: string[], depth = 0): void {
  if (error == null || depth > 4) return;
  if (typeof error === "string") {
    into.push(error);
    return;
  }
  if (typeof error !== "object") return;
  const rec = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (typeof rec.code === "string") into.push(rec.code);
  if (typeof rec.message === "string") into.push(rec.message);
  if (rec.cause && rec.cause !== error) collectErrorBlobs(rec.cause, into, depth + 1);
}

/** Expo often wraps Kotlin `CodedException` as `ERR_…` without a `saf_*` code. */
function extractSafCode(error: unknown): string | null {
  const blobs: string[] = [];
  collectErrorBlobs(error, blobs);
  for (const blob of blobs) {
    const match = blob.toLowerCase().match(/saf_[a-z_]+/);
    if (match) return match[0];
  }
  const text = blobs.join(" ").toLowerCase();
  if (text.includes("cannot create") && text.includes(".upriv")) {
    return "saf_create_failed";
  }
  if (
    text.includes("permission denied") ||
    text.includes("not writable") ||
    text.includes("saf tree is not writable")
  ) {
    return "saf_unauthorized";
  }
  return null;
}

/** Expo `CodedException` / unknown → `RpcError` so UI i18n can map the code. */
export function toSafRpcError(error: unknown, treeUri: string): RpcError {
  if (error instanceof RpcError) return error;
  const safCode = extractSafCode(error);
  const fallbackCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : "io_error";
  const message =
    error instanceof Error && error.message ? error.message : `SAF failure for ${treeUri}`;
  return new RpcError(safCode ?? fallbackCode, message, { path: treeUri });
}

/**
 * Runtime status of `.upriv/settings.toml` under a SAF tree URI.
 * Adds `"unauthorized"` on top of Rust `VaultRootDirStatus` for perm loss
 * (user cleared / OTG unmounted) — caller UI should re-persist / re-pick.
 */
export type SafInspectStatus = SafRootStatus;

export function safInspectRoot(treeUri: string): SafInspectStatus {
  return requireNative().safInspectRoot(treeUri);
}

/** Take persistable read/write permission. Idempotent; safe after picker. */
export function safPersist(treeUri: string): void {
  requireNative().safPersistPermission(treeUri);
}

/** Best-effort release of persistable permission. Missing perm not an error. */
export function safRelease(treeUri: string): void {
  requireNative().safReleasePermission(treeUri);
}

/**
 * Create `.upriv/settings.toml` + `{vaults,logs,app,runtime}` subfolders at the tree.
 * `settingsTomlOverride` (from `rpcAppSettingsSerializeToml`) atomically
 * seeds a fresh marker; falls back to the built-in template with `[ui].locale`
 * when null (parity with Rust `initial_settings_toml_for`).
 * `replacePolicy` mirrors Rust incomplete replace (`delete` | `rename`).
 */
export function safSetupRoot(
  treeUri: string,
  locale: string | null,
  settingsTomlOverride: string | null,
  replacePolicy: "delete" | "rename" | null = null,
): void {
  requireNative().safSetupRoot(treeUri, locale, settingsTomlOverride, replacePolicy);
}

export function safReadSettings(treeUri: string): string | null {
  return requireNative().safReadSettings(treeUri);
}

export function safWriteSettings(treeUri: string, contents: string): void {
  requireNative().safWriteSettings(treeUri, contents);
}

/**
 * Get the persisted "active SAF tree URI" pref (empty string / null = inactive).
 * Stored in Android SharedPreferences by Kotlin, outside the vault-root itself
 * (analogous to the Rust `.upriv-root` alias, but for `content://` URIs).
 */
export function safGetActiveUri(): string | null {
  const native = getUprivCoreNative();
  if (!native) return null;
  const uri = native.safGetActiveUri();
  return uri && uri.length > 0 ? uri : null;
}

export function safSetActiveUri(uri: string | null): void {
  requireNative().safSetActiveUri(uri ?? "");
}
