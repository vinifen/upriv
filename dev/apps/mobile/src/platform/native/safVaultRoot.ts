import { RpcError, VAULT_ROOT_ERROR_CODES } from "@upriv/shared";
import { getUprivCoreNative, type UprivCoreNativeModule } from "upriv-core";

/**
 * SAF (Android Storage Access Framework) surface used by mobile services.
 *
 * The data folder the list selects is mounted at Rust `/upriv-saf-root`
 * (`mountSafRoot`): a row's picked tree, or Default's Documents grant. Every
 * other picked folder (a row of another list, an export's folder) is a tree
 * Rust reaches at its own root (`mountTree`).
 *
 * Layering:
 * - Kotlin (`SafVaultRoot.kt`): grants
 * - Kotlin (`SafFs.kt`): the bridges Rust reads and writes through
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

/** Take persistable read/write permission. Idempotent; safe after picker. */
export function safPersist(treeUri: string): void {
  try {
    requireNative().safPersistPermission(treeUri);
  } catch (error) {
    throw toSafRpcError(error, treeUri);
  }
}

/**
 * Drop the grant of a one-shot folder pick (a file-manager import). Kotlin
 * keeps the grants still in use: the data folder, Default's Documents grant,
 * and a mounted tree.
 */
export function safReleaseImportTree(treeUri: string): void {
  if (!isSafTreeUri(treeUri)) return;
  try {
    getUprivCoreNative()?.safReleasePermission(treeUri.trim());
  } catch {
    /* already gone */
  }
}

/** The held grant Default lives in (Documents, or Documents/Upriv); `null` until confirmed. */
export function safDocumentsGrant(): string | null {
  const uri = getUprivCoreNative()?.safDocumentsGrant().trim();
  return uri && uri.length > 0 ? uri : null;
}

/** Where Rust reaches the data folder. */
const DATA_FOLDER_ROOT = "/upriv-saf-root";

/** The tree `/upriv-saf-root` serves now; `null` while none is mounted. */
let dataFolderTree: string | null = null;

/** The tree each picked root serves, by the root Rust reaches it at. */
const pickedRoots = new Map<string, string>();

/**
 * Point Rust `/upriv-saf-root` at this persisted tree.
 * An unplugged drive throws `vault_root_unreachable`; the grant is kept so a
 * reconnect works without picking the folder again.
 */
export function mountSafRoot(treeUri: string): void {
  try {
    requireNative().mountSafRoot(treeUri);
    dataFolderTree = treeUri.trim();
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
  dataFolderTree = null;
  const native = getUprivCoreNative();
  try {
    native?.unmountSafRoot();
  } catch {
    /* already unmounted */
  }
}

/**
 * Let Rust reach a picked tree at its own root, and return that root. Binds
 * only: a drive that is away fails on its first use.
 */
export function mountTree(treeUri: string): string {
  try {
    const root = requireNative().mountTree(treeUri.trim());
    pickedRoots.set(root.replace(/\/+$/, ""), treeUri.trim());
    return root;
  } catch (error) {
    throw toSafRpcError(error, treeUri);
  }
}

/**
 * The tree a path Rust uses is in, and the rest of the path: the data folder
 * at `/upriv-saf-root`, or a picked tree at its own root. `null` for any
 * other path.
 */
export function treeOfPath(
  path: string,
): { tree: string; rest: string; dataFolder: boolean } | null {
  const normalized = path.trim().replace(/\/+$/, "");
  const inside = (root: string) =>
    normalized === root
      ? ""
      : normalized.startsWith(`${root}/`)
        ? normalized.slice(root.length + 1)
        : null;
  if (dataFolderTree) {
    const rest = inside(DATA_FOLDER_ROOT);
    if (rest !== null) return { tree: dataFolderTree, rest, dataFolder: true };
  }
  for (const [root, tree] of pickedRoots) {
    const rest = inside(root);
    if (rest !== null) return { tree, rest, dataFolder: false };
  }
  return null;
}

/** Throw `saf_unauthorized` when a picked tree's grant is gone, `saf_unreachable` when it is away. */
export function checkTree(treeUri: string): void {
  try {
    requireNative().checkTree(treeUri.trim());
  } catch (error) {
    throw toSafRpcError(error, treeUri);
  }
}

/** Drop a tree's mount. Its grant stays until it is released. */
export function unmountTree(treeUri: string): void {
  for (const [root, tree] of pickedRoots) {
    if (tree === treeUri.trim()) pickedRoots.delete(root);
  }
  try {
    getUprivCoreNative()?.unmountTree(treeUri.trim());
  } catch {
    /* already unmounted */
  }
}

/** Starting URI for the data-folder screen (Documents). Null without the native module. */
export function safDocumentsInitialUri(): string | null {
  const uri = getUprivCoreNative()?.safDocumentsInitialUri().trim();
  return uri && uri.length > 0 ? uri : null;
}
