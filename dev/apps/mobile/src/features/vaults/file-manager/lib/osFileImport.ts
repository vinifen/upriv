import { Platform } from "react-native";
import {
  EncodingType,
  cacheDirectory,
  deleteAsync,
  getInfoAsync,
  readAsStringAsync,
  StorageAccessFramework,
} from "expo-file-system";
import {
  imageDataUrlFromBase64,
  isVaultImportUnsupported,
  sanitizeLogicalFileName,
  vaultFileLanguageFromPath,
} from "@upriv/shared";
import { safReleaseImportTree } from "@/platform/native/safVaultRoot";
import { safDocumentName } from "./safDocumentName";

export interface MobileImportFile {
  name: string;
  relativePath: string;
  content: string;
}

export interface MobileImportPick {
  files: MobileImportFile[];
  skippedUnsupported: number;
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

async function readAssetContent(asset: {
  name: string;
  uri: string;
  mimeType?: string;
}): Promise<string> {
  const language = vaultFileLanguageFromPath(asset.name);
  if (language === "image") {
    const base64 = await readAsStringAsync(asset.uri, { encoding: EncodingType.Base64 });
    return imageDataUrlFromBase64(base64, asset.name, asset.mimeType);
  }
  return readAsStringAsync(asset.uri, { encoding: EncodingType.UTF8 });
}

const pendingCacheWipeUris = new Set<string>();
let wipeFailedReporter: (() => void) | null = null;
let wipeFailLogged = false;

/** Product logger hook — never pass the cache URI. */
export function setPickerCacheWipeFailedReporter(reporter: (() => void) | null): void {
  wipeFailedReporter = reporter;
}

/** Picker copies into app cache so we can read SAF URIs — wipe after read. */
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

function importReadError(name: string): Error {
  const error = new Error(name);
  error.name = "ImportReadError";
  return error;
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
  let skippedUnsupported = 0;
  let firstFailedName: string | null = null;
  for (const asset of result.assets) {
    const name = sanitizeLogicalFileName(asset.name ?? "", "file");
    try {
      if (isVaultImportUnsupported(name)) {
        skippedUnsupported += 1;
        continue;
      }
      const content = await readAssetContent(asset);
      out.push({ name, relativePath: name, content });
    } catch {
      firstFailedName ??= name;
    } finally {
      await wipePickerCacheCopy(asset.uri);
    }
  }
  await retryPendingPickerCacheWipes();
  if (out.length === 0 && firstFailedName) {
    throw importReadError(firstFailedName);
  }
  return { files: out, skippedUnsupported };
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
  skippedUnsupported: { current: number },
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
      await collectSafTree(childUri, nextPrefix, out, firstFailedName, skippedUnsupported);
      continue;
    }
    const name = sanitizeLogicalFileName(rawName, "file");
    if (isVaultImportUnsupported(name)) {
      skippedUnsupported.current += 1;
      continue;
    }
    try {
      const content = await readAssetContent({ name, uri: childUri });
      out.push({
        name,
        relativePath: prefix ? `${prefix}/${name}` : name,
        content,
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
    const skippedUnsupported = { current: 0 };
    await collectSafTree(directoryUri, folderName, out, firstFailedName, skippedUnsupported);
    if (out.length === 0 && firstFailedName.current) {
      throw importReadError(firstFailedName.current);
    }
    return { files: out, skippedUnsupported: skippedUnsupported.current };
  } finally {
    safReleaseImportTree(directoryUri);
  }
}
