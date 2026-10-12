import { RpcError, VAULT_ROOT_ERROR_CODES } from "@upriv/shared";
import { getUprivCoreNative, type SafRootStatus, type UprivCoreNativeModule } from "upriv-core";
import { shouldReleaseImportTreePermission } from "./sameSafTreeUri";

/**
 * SAF (Android Storage Access Framework) surface used by mobile services.
 *
 * A picked `content://` folder is the data folder. Rust addresses it as
 * `/upriv-saf-root` and this module mounts that path onto the grant
 * (`mountSafRoot`). Inspect of a picked folder reads `.upriv/settings.toml`
 * through SAF without mounting it, so an open vault keeps its mount.
 *
 * Layering:
 * - Kotlin (`SafVaultRoot.kt`): grants and read-only probes
 * - Kotlin (`SafFs.kt`): the bridge Rust writes through
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
  if (text.includes("permission denied")) return "saf_unauthorized";
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
  try {
    requireNative().safPersistPermission(treeUri);
  } catch (error) {
    throw toSafRpcError(error, treeUri);
  }
}

/** Best-effort release of persistable permission. Missing perm not an error. */
export function safRelease(treeUri: string): void {
  requireNative().safReleasePermission(treeUri);
}

/**
 * Drop the persistable grant from a one-shot folder pick (file-manager import).
 * No-op when native is missing (Expo Go) or when the URI is the active vault-root.
 * Native `safReleasePermission` also refuses to drop the active tree.
 */
export function safReleaseImportTree(treeUri: string): void {
  const native = getUprivCoreNative();
  if (!native) return;
  const active = native.safGetActiveUri()?.trim() || null;
  if (!shouldReleaseImportTreePermission(treeUri, active)) return;
  try {
    native.safReleasePermission(treeUri.trim());
  } catch {
    /* already gone */
  }
}

export function safReadSettings(treeUri: string): string | null {
  return requireNative().safReadSettings(treeUri);
}

/**
 * The tree mounted at `/upriv-saf-root` (empty string / null = nothing mounted).
 * SharedPreferences store only this pointer. The last Custom folder is the
 * `custom=` line in the app-home `.upriv-root`.
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

/**
 * Point Rust `/upriv-saf-root` at this persisted tree.
 * An unplugged drive throws `vault_root_unreachable`: the grant and the
 * pointer are kept so a reconnect works without picking the folder again.
 */
export function mountSafRoot(treeUri: string): void {
  try {
    requireNative().mountSafRoot(treeUri);
  } catch (error) {
    const rpc = toSafRpcError(error, treeUri);
    if (rpc.code === "saf_unreachable") {
      throw new RpcError(VAULT_ROOT_ERROR_CODES.UNREACHABLE, rpc.message, { path: treeUri });
    }
    throw rpc;
  }
}

/** Drop the Rust mount. The persistable grant is left in place. */
export function unmountSafRoot(): void {
  const native = getUprivCoreNative();
  try {
    native?.unmountSafRoot();
  } catch {
    /* already unmounted */
  }
}

/** Starting URI for the data-folder screen (Documents). Null when the bridge has no helper. */
export function safDocumentsInitialUri(): string | null {
  const uri = getUprivCoreNative()?.safDocumentsInitialUri?.()?.trim();
  return uri && uri.length > 0 ? uri : null;
}
