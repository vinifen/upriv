import { Platform } from "react-native";
import { StorageAccessFramework } from "expo-file-system";

/**
 * Opens the Android system directory picker (SAF).
 * Returns a persistable `content://` tree URI, or `null` if cancelled / unavailable.
 *
 * Desktop equivalent: Electron `dialog.showOpenDialog({ openDirectory })`.
 * iOS has no directory SAF equivalent in Expo — returns `null`.
 */
export async function pickVaultRootFolder(initialUri?: string | null): Promise<string | null> {
  if (Platform.OS !== "android") {
    return null;
  }

  const initial =
    typeof initialUri === "string" && initialUri.startsWith("content://") ? initialUri : null;

  const result = await StorageAccessFramework.requestDirectoryPermissionsAsync(initial);
  if (!result.granted) return null;
  const uri = result.directoryUri?.trim();
  return uri && uri.length > 0 ? uri : null;
}

/** Android SAF tree / document URIs — not usable by Rust `std::fs` yet. */
export function isAndroidSafUri(path: string): boolean {
  const trimmed = path.trim();
  return trimmed.startsWith("content://");
}
