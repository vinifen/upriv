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
  skippedUnsupported: number;
  releaseSafTree?: string;
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

function importReadError(name: string): Error {
  const error = new Error(name);
  error.name = "ImportReadError";
  return error;
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
      copyToCacheDirectory: true,
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

async function isSafDirectory(uri: string): Promise<boolean> {
  try {
    const info = await getInfoAsync(uri);
    if (info.exists && typeof info.isDirectory === "boolean") return info.isDirectory;
  } catch {
    /* Some SAF documents reject getInfoAsync — try listing. */
  }
  try {
    await StorageAccessFramework.readDirectoryAsync(uri);
    return true;
  } catch {
    return false;
  }
}

async function collectSafTree(
  dirUri: string,
  prefix: string,
  out: MobileImportFile[],
  firstFailedName: { current: string | null },
): Promise<void> {
  let children: string[];
  try {
    children = await StorageAccessFramework.readDirectoryAsync(dirUri);
  } catch {
    return;
  }
  for (const childUri of children) {
    const rawName = safDocumentName(childUri);
    if (await isSafDirectory(childUri)) {
      const folderName = sanitizeLogicalFileName(rawName, "folder");
      const nextPrefix = prefix ? `${prefix}/${folderName}` : folderName;
      await collectSafTree(childUri, nextPrefix, out, firstFailedName);
      continue;
    }
    const name = sanitizeLogicalFileName(rawName, "file");
    try {
      out.push({
        name,
        relativePath: prefix ? `${prefix}/${name}` : name,
        uri: childUri,
        size: await uriSize(childUri),
      });
    } catch {
      firstFailedName.current ??= name;
    }
  }
}

/**
 * Android SAF directory picker — desktop `webkitdirectory` parity.
 * Relative paths include the picked folder name (same as Chromium).
 * iOS has no directory SAF equivalent in Expo.
 * Returns `null` when the user cancels.
 *
 * Expo always takes a persistable grant; drop it after the read unless this
 * tree is the active custom vault-root (`safReleaseImportTree`).
 */
export async function pickImportFolder(): Promise<MobileImportPick | null> {
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

  try {
    const folderName = sanitizeLogicalFileName(safDocumentName(directoryUri), "folder");
    const out: MobileImportFile[] = [];
    const firstFailedName = { current: null as string | null };
    await collectSafTree(directoryUri, folderName, out, firstFailedName);
    if (out.length === 0 && firstFailedName.current) {
      throw importReadError(firstFailedName.current);
    }
    return { files: out, skippedUnsupported: 0, releaseSafTree: directoryUri };
  } catch (error) {
    safReleaseImportTree(directoryUri);
    throw error;
  }
}
