import { Platform } from "react-native";
import { toByteArray } from "base64-js";
import {
  EncodingType,
  cacheDirectory,
  deleteAsync,
  getInfoAsync,
  readAsStringAsync,
  StorageAccessFramework,
} from "expo-file-system";
import {
  VAULT_FS_INLINE_CHUNK_BYTES,
  sanitizeLogicalFileName,
  type VaultBinaryByteSource,
} from "@upriv/shared";
import { safReleaseImportTree } from "@/platform/native/safVaultRoot";
import { safDocumentName } from "./safDocumentName";

export interface MobileImportFile {
  name: string;
  relativePath: string;
  uri: string;
  size: number;
  cacheUri?: string;
}

export interface MobileImportPick {
  files: MobileImportFile[];
  /** Folder paths relative to the pick, including the picked folder name. */
  directories?: string[];
  /** Display name of a picked folder. */
  folderName?: string;
  skippedUnsupported: number;
  releaseSafTree?: string;
}

/** Names known so far. Published before the rest of the tree is classified. */
export interface ListedImportFolder {
  files: MobileImportFile[];
  directories: string[];
}

export interface ListGrantedImportFolderOptions {
  /** Called as each directory's names are known, before the walk finishes. */
  onSnapshot?: (snapshot: ListedImportFolder) => void;
  /** Stop before the next directory. Rows already reported stay listed. */
  shouldStop?: () => boolean;
}

export class DocumentPickerUnavailableError extends Error {
  constructor() {
    super("DOCUMENT_PICKER_UNAVAILABLE");
    this.name = "DocumentPickerUnavailableError";
  }
}

export class FolderPickerUnavailableError extends Error {
  constructor() {
    super("FOLDER_PICKER_UNAVAILABLE");
    this.name = "FolderPickerUnavailableError";
  }
}

type DocumentPickerModule = typeof import("expo-document-picker");

function isNativeModuleMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ExpoDocumentPicker|native module/i.test(message);
}

function loadDocumentPicker(): DocumentPickerModule {
  try {
    return require("expo-document-picker") as DocumentPickerModule;
  } catch (error) {
    if (isNativeModuleMissing(error)) throw new DocumentPickerUnavailableError();
    throw error;
  }
}

const pendingCacheWipeUris = new Set<string>();
let wipeFailedReporter: (() => void) | null = null;
let wipeFailLogged = false;

/** Product logger hook — never pass the cache URI. */
export function setPickerCacheWipeFailedReporter(reporter: (() => void) | null): void {
  wipeFailedReporter = reporter;
}

/** Picker copies into app cache so we can read SAF URIs — wipe after import. */
async function wipePickerCacheCopy(uri: string): Promise<void> {
  if (!cacheDirectory || !uri.startsWith(cacheDirectory)) return;
  try {
    await deleteAsync(uri, { idempotent: true });
    pendingCacheWipeUris.delete(uri);
    if (pendingCacheWipeUris.size === 0) wipeFailLogged = false;
  } catch {
    pendingCacheWipeUris.add(uri);
    if (!wipeFailLogged) {
      wipeFailLogged = true;
      wipeFailedReporter?.();
    }
  }
}

/** Retry failed picker-cache deletes. */
export async function retryPendingPickerCacheWipes(): Promise<void> {
  const uris = [...pendingCacheWipeUris];
  for (const uri of uris) {
    await wipePickerCacheCopy(uri);
  }
}

export async function finishMobileImportSession(
  files: readonly MobileImportFile[],
  releaseSafTree?: string,
): Promise<void> {
  for (const file of files) {
    if (file.cacheUri) await wipePickerCacheCopy(file.cacheUri);
  }
  await retryPendingPickerCacheWipes();
  if (releaseSafTree) safReleaseImportTree(releaseSafTree);
}

/** `file://` / absolute path the native core can `File::open`. Not `content://`. */
export function nativeOsPathFromImportUri(uri: string): string | null {
  const trimmed = uri.trim();
  if (!trimmed || trimmed.startsWith("content:")) return null;
  if (trimmed.startsWith("file:")) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "file:") return null;
      let osPath = decodeURIComponent(parsed.pathname);
      if (/^\/[A-Za-z]:\//.test(osPath)) osPath = osPath.slice(1);
      return osPath || null;
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("/")) return trimmed;
  return null;
}

async function uriSize(uri: string, hinted?: number): Promise<number> {
  if (hinted && hinted > 0) return hinted;
  try {
    const info = await getInfoAsync(uri);
    if (info.exists && "size" in info && typeof info.size === "number" && info.size > 0) {
      return info.size;
    }
  } catch {
    /* size unknown */
  }
  return -1;
}

export async function uriByteSource(file: MobileImportFile): Promise<VaultBinaryByteSource> {
  const size = await uriSize(file.uri, file.size);
  if (size === 0) {
    return { size: 0, slice: async () => new Uint8Array() };
  }
  if (size < 0) {
    const b64 = await readAsStringAsync(file.uri, { encoding: EncodingType.Base64 });
    const bytes = b64 ? toByteArray(b64) : new Uint8Array();
    return {
      size: bytes.byteLength,
      slice: async (start, end) => bytes.subarray(start, end),
    };
  }
  return {
    size,
    slice: async (start, end) => {
      const length = Math.min(Math.max(0, end - start), VAULT_FS_INLINE_CHUNK_BYTES);
      if (length === 0) return new Uint8Array();
      const b64 = await readAsStringAsync(file.uri, {
        encoding: EncodingType.Base64,
        position: start,
        length,
      });
      if (!b64) return new Uint8Array();
      return toByteArray(b64);
    },
  };
}

/**
 * System file picker — flat multi-file pick (no folder tree).
 * Returns `null` when the user cancels.
 */
export async function pickImportFiles(): Promise<MobileImportPick | null> {
  const DocumentPicker = loadDocumentPicker();
  let result: Awaited<ReturnType<DocumentPickerModule["getDocumentAsync"]>>;
  try {
    result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: true,
      copyToCacheDirectory: Platform.OS !== "android",
    });
  } catch (error) {
    if (isNativeModuleMissing(error)) throw new DocumentPickerUnavailableError();
    throw error;
  }
  if (result.canceled || !result.assets?.length) return null;

  const out: MobileImportFile[] = [];
  for (const asset of result.assets) {
    const name = sanitizeLogicalFileName(asset.name ?? "", "file");
    const uri = asset.uri;
    out.push({
      name,
      relativePath: name,
      uri,
      size: typeof asset.size === "number" ? asset.size : 0,
      cacheUri: cacheDirectory && uri.startsWith(cacheDirectory) ? uri : undefined,
    });
  }
  return { files: out, skippedUnsupported: 0 };
}

/**
 * A content URI is a folder when its children can be listed.
 * `getInfoAsync` reports every openable content URI as a file, so a folder
 * would be stored as a document and the read would fail.
 */
async function isSafDirectory(uri: string): Promise<boolean> {
  if (uri.startsWith("content:")) {
    try {
      await StorageAccessFramework.readDirectoryAsync(uri);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const info = await getInfoAsync(uri);
    return Boolean(info.exists && info.isDirectory);
  } catch {
    return false;
  }
}

function publishListedFolder(
  options: ListGrantedImportFolderOptions | undefined,
  files: readonly MobileImportFile[],
  directories: readonly string[],
): void {
  options?.onSnapshot?.({ files: [...files], directories: [...directories] });
}

async function collectSafTree(
  dirUri: string,
  prefix: string,
  out: MobileImportFile[],
  directories: string[],
  failClosed: boolean,
  options?: ListGrantedImportFolderOptions,
): Promise<void> {
  if (options?.shouldStop?.()) return;
  let children: string[];
  try {
    children = await StorageAccessFramework.readDirectoryAsync(dirUri);
  } catch {
    if (failClosed) throw new Error("import folder is unreadable");
    return;
  }
  if (options?.shouldStop?.()) return;

  const provisional: MobileImportFile[] = [];
  for (const childUri of children) {
    const rawName = safDocumentName(childUri);
    const name = sanitizeLogicalFileName(rawName, "file");
    const file: MobileImportFile = {
      name,
      relativePath: prefix ? `${prefix}/${name}` : name,
      uri: childUri,
      size: 0,
    };
    provisional.push(file);
    out.push(file);
  }
  if (provisional.length > 0) publishListedFolder(options, out, directories);

  const nested: { uri: string; prefix: string }[] = [];
  for (const file of provisional) {
    if (options?.shouldStop?.()) return;
    if (!(await isSafDirectory(file.uri))) continue;
    const at = out.indexOf(file);
    if (at >= 0) out.splice(at, 1);
    const folderName = sanitizeLogicalFileName(safDocumentName(file.uri), "folder");
    const nextPrefix = prefix ? `${prefix}/${folderName}` : folderName;
    directories.push(nextPrefix);
    nested.push({ uri: file.uri, prefix: nextPrefix });
  }
  for (const dir of nested) {
    if (options?.shouldStop?.()) return;
    await collectSafTree(dir.uri, dir.prefix, out, directories, failClosed, options);
  }
}

/**
 * System folder picker. Does not walk the tree.
 * Returns `null` when the user cancels. iOS has no directory picker here.
 * The caller drops the persistable grant when the read finishes, unless this
 * tree is the active vault-root.
 */
export async function pickImportFolderGrant(): Promise<{
  directoryUri: string;
  folderName: string;
} | null> {
  if (Platform.OS !== "android") {
    throw new FolderPickerUnavailableError();
  }
  let directoryUri: string | null = null;
  try {
    const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!result.granted) return null;
    directoryUri = result.directoryUri?.trim() || null;
  } catch {
    throw new FolderPickerUnavailableError();
  }
  if (!directoryUri) return null;
  return {
    directoryUri,
    folderName: sanitizeLogicalFileName(safDocumentName(directoryUri), "folder"),
  };
}

/** Walk a folder the user already granted. */
export async function listGrantedImportFolder(
  directoryUri: string,
  folderName: string,
  failClosed: boolean,
  options?: ListGrantedImportFolderOptions,
): Promise<MobileImportPick> {
  const out: MobileImportFile[] = [];
  const directories: string[] = [];
  try {
    await collectSafTree(directoryUri, folderName, out, directories, failClosed, options);
  } catch (error) {
    safReleaseImportTree(directoryUri);
    throw error;
  }
  if (!options?.shouldStop?.()) {
    options?.onSnapshot?.({ files: [...out], directories: [...directories] });
  }
  return {
    files: out,
    directories,
    folderName,
    skippedUnsupported: 0,
    releaseSafTree: directoryUri,
  };
}

export async function pickImportFolder(options?: {
  /** A listing failure fails the pick. File-manager imports keep going. */
  failClosed?: boolean;
}): Promise<MobileImportPick | null> {
  const grant = await pickImportFolderGrant();
  if (!grant) return null;
  return listGrantedImportFolder(
    grant.directoryUri,
    grant.folderName,
    options?.failClosed === true,
  );
}
