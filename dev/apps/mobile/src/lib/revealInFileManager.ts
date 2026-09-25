import { Linking, Platform } from "react-native";
import { RpcError, VAULT_ERROR_CODES } from "@upriv/shared";
import { getUprivCoreNative } from "upriv-core";

const OPEN_FAILED = "open_path_failed";

/**
 * Open `osPath` in the OS file manager (Android Files, iOS Files when the URL
 * is accepted). Does not dump vault plaintext — callers must pass a live mount.
 */
export async function revealInOsFileManager(osPath: string): Promise<void> {
  const trimmed = osPath.trim();
  if (!trimmed) {
    throw new RpcError(OPEN_FAILED, "path must be absolute");
  }
  const native = getUprivCoreNative();
  if (native && typeof native.revealInFileManager === "function") {
    native.revealInFileManager(trimmed);
    return;
  }
  const fileUrl =
    trimmed.startsWith("file://") || trimmed.startsWith("content://")
      ? trimmed
      : `file://${trimmed}`;
  try {
    const canOpen = await Linking.canOpenURL(fileUrl);
    if (canOpen) {
      await Linking.openURL(fileUrl);
      return;
    }
  } catch (error) {
    throw new RpcError(
      OPEN_FAILED,
      error instanceof Error ? error.message : "could not open file manager",
    );
  }
  if (Platform.OS === "ios" || Platform.OS === "android") {
    throw new RpcError(
      VAULT_ERROR_CODES.MOUNT_FAILED,
      "OS mount is not available; use the in-app file manager",
    );
  }
  throw new RpcError(OPEN_FAILED, "no system file manager");
}
